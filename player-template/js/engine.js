// engine.js — ノベルゲーム ランタイム(プレイヤー)本体
// window.GAME_DATA (data.js で埋め込まれる) を解釈して実行する。
// 依存ライブラリなし。file:// で直接開いても動作するように fetch/XHR は使用しない。

(function () {
  'use strict';

  const DATA = window.GAME_DATA;
  if (!DATA) {
    document.body.innerHTML = '<p style="color:#fff;padding:20px">ゲームデータ(data.js)が見つかりません。</p>';
    return;
  }

  const SAVE_KEY_PREFIX = 'vnsave:' + (DATA.meta.saveId || 'game') + ':';
  const SLOT_COUNT = 12;
  const TYPE_SPEED_MS = 26; // 1文字あたりのタイプ速度

  // --- DOM参照 -------------------------------------------------------------
  const el = {};
  function cacheDom() {
    el.screenTitle = document.getElementById('screen-title');
    el.screenGame = document.getElementById('screen-game');
    el.screenEnding = document.getElementById('screen-ending');
    el.gameTitle = document.getElementById('game-title');
    el.gameAuthor = document.getElementById('game-author');
    el.btnNewGame = document.getElementById('btn-newgame');
    el.btnContinue = document.getElementById('btn-continue');
    el.btnLoadGame = document.getElementById('btn-loadgame');
    el.bgImage = document.getElementById('bg-image');
    el.charImgs = Array.from(document.querySelectorAll('.char-img'));
    el.choiceLayer = document.getElementById('choice-layer');
    el.speakerName = document.getElementById('speaker-name');
    el.textBody = document.getElementById('text-body');
    el.advanceIndicator = document.getElementById('advance-indicator');
    el.btnSave = document.getElementById('btn-save');
    el.btnLoad = document.getElementById('btn-load');
    el.btnTitle = document.getElementById('btn-title');
    el.btnEndingTitle = document.getElementById('btn-ending-title');
    el.saveloadOverlay = document.getElementById('saveload-overlay');
    el.saveloadTitleText = document.getElementById('saveload-title-text');
    el.saveSlotGrid = document.getElementById('save-slot-grid');
    el.btnSaveloadClose = document.getElementById('btn-saveload-close');
    el.bgmAudio = document.getElementById('bgm-audio');
    el.voiceAudio = document.getElementById('voice-audio');
    el.screenGameEl = document.getElementById('screen-game');
  }

  // --- 実行時の状態 ----------------------------------------------------------
  let vars = {};
  let sceneId = null;
  let cmdIndex = 0;
  let shownChars = {}; // charId -> { image, position }
  let currentBg = null;
  let currentBgmFile = null;
  let currentBgmLoop = true;
  let isTyping = false;
  let completeTypingFn = null;
  let resolveAdvance = null;
  let saveloadMode = null; // 'save' | 'load'

  function initVars() {
    vars = {};
    (DATA.variables || []).forEach((v) => { vars[v.key] = v.default; });
  }

  // --- 式評価 (条件式・値の式) -------------------------------------------------
  function evalExpr(expr) {
    if (expr === undefined || expr === null || String(expr).trim() === '') return true;
    try {
      // ユーザー自身が自分のシナリオ内に書いた式のみを評価する(ローカル利用が前提)。
      const fn = new Function('vars', 'with (vars) { return (' + expr + '); }');
      return fn(vars);
    } catch (e) {
      console.error('式の評価でエラー:', expr, e);
      return false;
    }
  }

  function resolveValue(cmd) {
    const value = cmd.value;
    switch (cmd.valueType) {
      case 'number': return parseFloat(value);
      case 'boolean': return value === true || value === 'true';
      case 'expression': return evalExpr(value);
      case 'string':
      default: return value;
    }
  }

  function applySetVar(cmd) {
    const key = cmd.key;
    if (!key) return;
    if (!(key in vars)) vars[key] = 0;
    const val = resolveValue(cmd);
    switch (cmd.op) {
      case '=': vars[key] = val; break;
      case '+=': vars[key] = (Number(vars[key]) || 0) + Number(val); break;
      case '-=': vars[key] = (Number(vars[key]) || 0) - Number(val); break;
      case '*=': vars[key] = (Number(vars[key]) || 0) * Number(val); break;
      case '/=': vars[key] = (Number(vars[key]) || 0) / Number(val); break;
      case 'toggle': vars[key] = !vars[key]; break;
      default: break;
    }
  }

  // --- 表示ヘルパー ------------------------------------------------------------
  function assetPath(category, file) {
    if (!file) return '';
    return 'assets/' + category + '/' + file;
  }

  function setBackground(image, transition, duration) {
    currentBg = image || null;
    const src = image ? assetPath('bg', image) : '';
    if (!image) {
      el.bgImage.classList.remove('visible');
      return Promise.resolve();
    }
    if (transition === 'none') {
      el.bgImage.style.transitionDuration = '0s';
      el.bgImage.src = src;
      el.bgImage.classList.add('visible');
      return Promise.resolve();
    }
    const dur = duration || 0.6;
    el.bgImage.style.transitionDuration = dur + 's';
    el.bgImage.classList.remove('visible');
    return new Promise((resolve) => {
      setTimeout(() => {
        el.bgImage.src = src;
        requestAnimationFrame(() => {
          el.bgImage.classList.add('visible');
          setTimeout(resolve, dur * 1000);
        });
      }, 60);
    });
  }

  function setBackgroundInstant(image) {
    currentBg = image || null;
    if (!image) { el.bgImage.classList.remove('visible'); return; }
    el.bgImage.style.transitionDuration = '0s';
    el.bgImage.src = assetPath('bg', image);
    el.bgImage.classList.add('visible');
  }

  function findCharSlot(position) {
    return el.charImgs.find((img) => img.dataset.pos === position);
  }
  function findCharSlotById(charId) {
    return el.charImgs.find((img) => img.dataset.charId === charId);
  }

  function showCharacter(charId, image, position, transition, duration) {
    // 既に別の位置に表示中なら一旦消す
    const existing = findCharSlotById(charId);
    if (existing && existing.dataset.pos !== position) {
      existing.classList.remove('visible');
      delete existing.dataset.charId;
    }
    const slot = findCharSlot(position);
    if (!slot) return Promise.resolve();
    shownChars[charId] = { image, position };
    slot.dataset.charId = charId;
    const dur = transition === 'none' ? 0 : (duration || 0.4);
    slot.style.transitionDuration = dur + 's';
    if (dur === 0) {
      slot.src = assetPath('char', image);
      slot.classList.add('visible');
      return Promise.resolve();
    }
    slot.classList.remove('visible');
    return new Promise((resolve) => {
      setTimeout(() => {
        slot.src = assetPath('char', image);
        requestAnimationFrame(() => {
          slot.classList.add('visible');
          setTimeout(resolve, dur * 1000);
        });
      }, 40);
    });
  }

  function showCharacterInstant(charId, image, position) {
    const slot = findCharSlot(position);
    if (!slot) return;
    shownChars[charId] = { image, position };
    slot.dataset.charId = charId;
    slot.style.transitionDuration = '0s';
    slot.src = assetPath('char', image);
    slot.classList.add('visible');
  }

  function hideCharacter(charId, transition, duration) {
    const slot = findCharSlotById(charId);
    delete shownChars[charId];
    if (!slot) return Promise.resolve();
    const dur = transition === 'none' ? 0 : (duration || 0.4);
    slot.style.transitionDuration = dur + 's';
    slot.classList.remove('visible');
    delete slot.dataset.charId;
    return new Promise((resolve) => setTimeout(resolve, dur * 1000));
  }

  function clearAllCharactersInstant() {
    shownChars = {};
    el.charImgs.forEach((img) => {
      img.style.transitionDuration = '0s';
      img.classList.remove('visible');
      img.src = '';
      delete img.dataset.charId;
    });
  }

  function playBgm(file, loop, fadeIn) {
    currentBgmFile = file || null;
    currentBgmLoop = loop !== false;
    if (!file) return;
    el.bgmAudio.src = assetPath('bgm', file);
    el.bgmAudio.loop = currentBgmLoop;
    const targetVolume = 1;
    if (fadeIn && fadeIn > 0) {
      el.bgmAudio.volume = 0;
      el.bgmAudio.play().catch(() => {});
      fadeAudio(el.bgmAudio, 0, targetVolume, fadeIn);
    } else {
      el.bgmAudio.volume = targetVolume;
      el.bgmAudio.play().catch(() => {});
    }
  }

  function stopBgm(fadeOut) {
    if (fadeOut && fadeOut > 0) {
      fadeAudio(el.bgmAudio, el.bgmAudio.volume, 0, fadeOut, () => {
        el.bgmAudio.pause();
        currentBgmFile = null;
      });
    } else {
      el.bgmAudio.pause();
      currentBgmFile = null;
    }
  }

  function fadeAudio(audio, from, to, seconds, onDone) {
    const steps = Math.max(1, Math.round(seconds * 20));
    let i = 0;
    audio.volume = from;
    const timer = setInterval(() => {
      i++;
      audio.volume = from + (to - from) * (i / steps);
      if (i >= steps) {
        clearInterval(timer);
        audio.volume = to;
        if (onDone) onDone();
      }
    }, seconds * 1000 / steps);
  }

  function playSe(file) {
    if (!file) return;
    const a = new Audio(assetPath('se', file));
    a.play().catch(() => {});
  }

  function playVoice(file) {
    if (!file) return;
    el.voiceAudio.src = assetPath('voice', file);
    el.voiceAudio.play().catch(() => {});
  }

  // --- テキスト表示(タイプライター) --------------------------------------------
  function typeText(text) {
    return new Promise((resolve) => {
      isTyping = true;
      el.textBody.textContent = '';
      el.advanceIndicator.classList.remove('show');
      let i = 0;
      let timer = null;
      function finish() {
        isTyping = false;
        clearTimeout(timer);
        el.textBody.textContent = text;
        el.advanceIndicator.classList.add('show');
        completeTypingFn = null;
        resolve();
      }
      completeTypingFn = finish;
      function step() {
        if (!isTyping) return;
        if (i >= text.length) { finish(); return; }
        el.textBody.textContent += text[i];
        i++;
        timer = setTimeout(step, TYPE_SPEED_MS);
      }
      if (!text) { finish(); return; }
      step();
    });
  }

  function waitForAdvance() {
    return new Promise((resolve) => { resolveAdvance = resolve; });
  }

  function onScreenClick(e) {
    if (e.target.closest('#game-menu-bar') || e.target.closest('#choice-layer') || e.target.closest('#saveload-overlay')) return;
    if (isTyping && completeTypingFn) { completeTypingFn(); return; }
    if (resolveAdvance) { const r = resolveAdvance; resolveAdvance = null; r(); }
  }

  // --- 選択肢 ---------------------------------------------------------------
  function showChoices(options) {
    return new Promise((resolve) => {
      const visible = (options || []).filter((o) => evalExpr(o.condition));
      el.choiceLayer.innerHTML = '';
      if (visible.length === 0) { el.choiceLayer.classList.add('hidden'); resolve('continue'); return; }
      visible.forEach((opt) => {
        const btn = document.createElement('button');
        btn.textContent = opt.text || '(無題の選択肢)';
        btn.addEventListener('click', () => {
          el.choiceLayer.classList.add('hidden');
          if (opt.goto && DATA.scenes[opt.goto]) {
            sceneId = opt.goto;
            cmdIndex = 0;
            resolve('jumped');
          } else {
            resolve('continue');
          }
        });
        el.choiceLayer.appendChild(btn);
      });
      el.choiceLayer.classList.remove('hidden');
    });
  }

  // --- コマンド実行 -----------------------------------------------------------
  async function executeCommand(cmd) {
    switch (cmd.type) {
      case 'text': {
        el.speakerName.textContent = cmd.speaker || '';
        if (cmd.voice) playVoice(cmd.voice);
        await typeText(cmd.body || '');
        await waitForAdvance();
        el.advanceIndicator.classList.remove('show');
        return 'continue';
      }
      case 'bg':
        await setBackground(cmd.image, cmd.transition, cmd.duration);
        return 'continue';
      case 'char_show':
        await showCharacter(cmd.charId, cmd.image, cmd.position || 'center', cmd.transition, cmd.duration);
        return 'continue';
      case 'char_hide':
        await hideCharacter(cmd.charId, cmd.transition, cmd.duration);
        return 'continue';
      case 'bgm_play':
        playBgm(cmd.file, cmd.loop, cmd.fadeIn);
        return 'continue';
      case 'bgm_stop':
        stopBgm(cmd.fadeOut);
        return 'continue';
      case 'se_play':
        playSe(cmd.file);
        return 'continue';
      case 'voice_play':
        playVoice(cmd.file);
        return 'continue';
      case 'set_var':
        applySetVar(cmd);
        return 'continue';
      case 'choice':
        return await showChoices(cmd.options);
      case 'jump':
        if (evalExpr(cmd.condition)) {
          if (DATA.scenes[cmd.target]) { sceneId = cmd.target; cmdIndex = 0; return 'jumped'; }
          console.warn('ジャンプ先シーンが見つかりません:', cmd.target);
        }
        return 'continue';
      case 'end':
        showEnding();
        return 'wait';
      default:
        console.warn('不明なコマンド:', cmd.type);
        return 'continue';
    }
  }

  async function runLoop() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const scene = DATA.scenes[sceneId];
      if (!scene) { console.error('シーンが見つかりません:', sceneId); showEnding(); return; }
      if (cmdIndex >= scene.commands.length) { showEnding(); return; }
      const cmd = scene.commands[cmdIndex];
      const result = await executeCommand(cmd);
      if (result === 'wait') return;
      if (result === 'jumped') continue;
      cmdIndex++;
    }
  }

  // --- 画面切り替え -----------------------------------------------------------
  function showScreen(name) {
    [el.screenTitle, el.screenGame, el.screenEnding].forEach((s) => s.classList.add('hidden'));
    if (name === 'title') el.screenTitle.classList.remove('hidden');
    if (name === 'game') el.screenGame.classList.remove('hidden');
    if (name === 'ending') el.screenEnding.classList.remove('hidden');
  }

  function showEnding() {
    stopBgm(0.8);
    showScreen('ending');
  }

  function startNewGame() {
    initVars();
    clearAllCharactersInstant();
    setBackgroundInstant(null);
    stopBgm(0);
    sceneId = DATA.start;
    cmdIndex = 0;
    showScreen('game');
    runLoop();
  }

  function backToTitle() {
    stopBgm(0.5);
    resolveAdvance = null;
    completeTypingFn = null;
    isTyping = false;
    refreshContinueButton();
    showScreen('title');
  }

  // --- セーブ / ロード ---------------------------------------------------------
  // localStorageが使えない環境(file://を厳格にオペークオリジン扱いするブラウザ設定、
  // プライベートブラウジング、ストレージ容量超過など)でもゲームが落ちないように、
  // 常にtry/catchで包み、失敗時はメモリ上の一時ストア(セッション内のみ有効)へ
  // 自動的にフォールバックする。
  const memoryStore = {};
  let persistentStorageWarned = false;

  function warnNoPersistentStorage() {
    if (persistentStorageWarned) return;
    persistentStorageWarned = true;
    console.warn('このブラウザ環境ではセーブデータの永続化ができないため、アプリを閉じるとセーブ内容が失われる可能性があります。');
  }

  function storageGet(key) {
    try {
      const v = window.localStorage.getItem(key);
      if (v !== null && v !== undefined) return v;
    } catch (e) { /* フォールバックへ */ }
    return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
  }

  function storageSet(key, value) {
    memoryStore[key] = value; // 常にメモリにも保持し、読み込みの一貫性を保つ
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      warnNoPersistentStorage();
    }
  }

  function slotKey(i) { return SAVE_KEY_PREFIX + i; }

  function readSlot(i) {
    try {
      const raw = storageGet(slotKey(i));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeSlot(i, obj) {
    try {
      storageSet(slotKey(i), JSON.stringify(obj));
      return true;
    } catch (e) {
      alert('セーブに失敗しました');
      return false;
    }
  }

  function captureState() {
    const scene = DATA.scenes[sceneId];
    return {
      sceneId,
      cmdIndex,
      vars: Object.assign({}, vars),
      bg: currentBg,
      chars: JSON.parse(JSON.stringify(shownChars)),
      bgmFile: currentBgmFile,
      bgmLoop: currentBgmLoop,
      savedAt: Date.now(),
      label: scene ? (scene.name || sceneId) : sceneId,
      preview: (el.textBody.textContent || '').slice(0, 40)
    };
  }

  function restoreState(saveObj) {
    sceneId = saveObj.sceneId;
    cmdIndex = saveObj.cmdIndex;
    vars = Object.assign({}, saveObj.vars);
    clearAllCharactersInstant();
    Object.keys(saveObj.chars || {}).forEach((charId) => {
      const c = saveObj.chars[charId];
      showCharacterInstant(charId, c.image, c.position);
    });
    setBackgroundInstant(saveObj.bg);
    if (saveObj.bgmFile) playBgm(saveObj.bgmFile, saveObj.bgmLoop, 0); else stopBgm(0);
    el.speakerName.textContent = '';
    el.textBody.textContent = '';
    el.choiceLayer.classList.add('hidden');
    showScreen('game');
    runLoop();
  }

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function openSaveLoad(mode) {
    saveloadMode = mode;
    el.saveloadTitleText.textContent = mode === 'save' ? 'セーブ' : 'ロード';
    renderSlotGrid();
    el.saveloadOverlay.classList.remove('hidden');
  }

  function closeSaveLoad() {
    el.saveloadOverlay.classList.add('hidden');
  }

  function renderSlotGrid() {
    el.saveSlotGrid.innerHTML = '';
    for (let i = 0; i < SLOT_COUNT; i++) {
      const data = readSlot(i);
      const div = document.createElement('div');
      div.className = 'save-slot' + (data ? '' : ' empty');
      if (data) {
        div.innerHTML = `<div class="slot-index">Slot ${i + 1}</div>
          <div class="slot-label">${escapeHtml(data.label || '')}</div>
          <div class="slot-time">${formatTime(data.savedAt)}</div>`;
      } else {
        div.innerHTML = `<div class="slot-index">Slot ${i + 1}</div><div>(空き)</div>`;
      }
      div.addEventListener('click', () => onSlotClick(i, data));
      el.saveSlotGrid.appendChild(div);
    }
  }

  function onSlotClick(index, existingData) {
    if (saveloadMode === 'save') {
      if (existingData && !confirm('Slot ' + (index + 1) + ' に上書き保存しますか？')) return;
      const ok = writeSlot(index, captureState());
      if (ok) { renderSlotGrid(); }
    } else {
      if (!existingData) return;
      closeSaveLoad();
      restoreState(existingData);
    }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function findLatestSlot() {
    let best = null, bestIndex = -1;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const d = readSlot(i);
      if (d && (!best || d.savedAt > best.savedAt)) { best = d; bestIndex = i; }
    }
    return bestIndex >= 0 ? best : null;
  }

  function hasAnySave() {
    for (let i = 0; i < SLOT_COUNT; i++) { if (readSlot(i)) return true; }
    return false;
  }

  function refreshContinueButton() {
    el.btnContinue.disabled = !hasAnySave();
    el.btnLoadGame.disabled = !hasAnySave();
  }

  // --- 初期化 ---------------------------------------------------------------
  function bindEvents() {
    el.btnNewGame.addEventListener('click', startNewGame);
    el.btnContinue.addEventListener('click', () => {
      const latest = findLatestSlot();
      if (latest) restoreState(latest);
    });
    el.btnLoadGame.addEventListener('click', () => openSaveLoad('load'));
    el.btnSave.addEventListener('click', (e) => { e.stopPropagation(); openSaveLoad('save'); });
    el.btnLoad.addEventListener('click', (e) => { e.stopPropagation(); openSaveLoad('load'); });
    el.btnTitle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('タイトル画面に戻りますか？(セーブしていない進行状況は失われます)')) backToTitle();
    });
    el.btnEndingTitle.addEventListener('click', backToTitle);
    el.btnSaveloadClose.addEventListener('click', closeSaveLoad);
    el.screenGameEl.addEventListener('click', onScreenClick);
    window.addEventListener('keydown', (e) => {
      if (el.screenGame.classList.contains('hidden')) return;
      if (e.key === 'Enter' || e.key === ' ') { onScreenClick({ target: document.body }); }
    });
  }

  function init() {
    cacheDom();
    el.gameTitle.textContent = DATA.meta.title || 'ノベルゲーム';
    el.gameAuthor.textContent = DATA.meta.author ? ('作: ' + DATA.meta.author) : '';
    refreshContinueButton();
    bindEvents();
    showScreen('title');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
