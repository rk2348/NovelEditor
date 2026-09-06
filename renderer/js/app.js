// app.js — ノベルゲームエディタ レンダラー側ロジック(素のJS、フレームワーク不使用)

(function () {
  'use strict';

  const { COMMAND_TYPES, COMMAND_ORDER } = window.VN_SCHEMA;

  // ---------------------------------------------------------------------
  // 状態
  // ---------------------------------------------------------------------
  const state = {
    projectDir: null,
    projectPath: null,
    data: null,
    assets: { bg: [], char: [], bgm: [], se: [], voice: [] },
    currentSceneId: null,
    openCommandIndex: -1,
    dirty: false
  };

  function uid() {
    return 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function markDirty() {
    state.dirty = true;
    updateDirtyIndicator();
  }

  function updateDirtyIndicator() {
    const el = document.getElementById('dirty-indicator');
    el.textContent = state.dirty ? '● 未保存の変更' : '';
  }

  function setStatus(text) {
    document.getElementById('status-text').textContent = text;
  }

  // ---------------------------------------------------------------------
  // カスタム入力ダイアログ (window.prompt() の代替)
  // Electronは window.prompt() を正式にサポートしておらず、呼び出しても
  // 何も表示されずに処理が止まってしまうため、HTML/CSSで自前実装する。
  // ---------------------------------------------------------------------
  function showPromptDialog(message, defaultValue) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('prompt-overlay');
      const msgEl = document.getElementById('prompt-message');
      const inputEl = document.getElementById('prompt-input');
      const okBtn = document.getElementById('prompt-ok');
      const cancelBtn = document.getElementById('prompt-cancel');

      msgEl.textContent = message;
      inputEl.value = defaultValue || '';
      overlay.classList.remove('hidden');
      inputEl.focus();
      inputEl.select();

      function cleanup(result) {
        overlay.classList.add('hidden');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        inputEl.removeEventListener('keydown', onKeydown);
        resolve(result);
      }
      function onOk() { cleanup(inputEl.value.trim() || defaultValue || null); }
      function onCancel() { cleanup(null); }
      function onKeydown(e) {
        if (e.key === 'Enter') { e.preventDefault(); onOk(); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      inputEl.addEventListener('keydown', onKeydown);
    });
  }

  // ---------------------------------------------------------------------
  // プロジェクトのライフサイクル
  // ---------------------------------------------------------------------

  async function refreshAssets() {
    if (!state.projectDir) return;
    state.assets = await window.api.listAssets({ projectDir: state.projectDir });
  }

  async function newProject() {
    const dir = await window.api.selectDirectory({ title: '新しいプロジェクトを保存するフォルダを選択' });
    if (!dir) return;
    const title = (await showPromptDialog('作品タイトルを入力してください', '無題のノベルゲーム')) || '無題のノベルゲーム';
    try {
      const res = await window.api.createProject({ dir, title });
      state.projectDir = res.projectDir;
      state.projectPath = res.projectPath;
      state.data = res.data;
      state.currentSceneId = res.data.start;
      state.dirty = false;
      await refreshAssets();
      showEditor();
      renderAll();
      setStatus('新規プロジェクトを作成しました: ' + res.projectPath);
    } catch (e) {
      alert('プロジェクト作成に失敗しました: ' + e.message);
    }
  }

  async function openProject() {
    const projectPath = await window.api.selectProjectFile();
    if (!projectPath) return;
    try {
      const res = await window.api.openProject({ projectPath });
      state.projectDir = res.projectDir;
      state.projectPath = res.projectPath;
      state.data = res.data;
      state.currentSceneId = res.data.start || Object.keys(res.data.scenes)[0] || null;
      state.dirty = false;
      await refreshAssets();
      showEditor();
      renderAll();
      setStatus('開きました: ' + res.projectPath);
    } catch (e) {
      alert('プロジェクトを開けませんでした: ' + e.message);
    }
  }

  async function saveProject() {
    if (!state.projectPath) return;
    await window.api.saveProject({ projectPath: state.projectPath, data: state.data });
    state.dirty = false;
    updateDirtyIndicator();
    setStatus('保存しました: ' + state.projectPath);
  }

  function showEditor() {
    document.getElementById('welcome').classList.add('hidden');
    document.getElementById('main-layout').classList.remove('hidden');
  }

  // ---------------------------------------------------------------------
  // シーン操作
  // ---------------------------------------------------------------------

  function addScene() {
    const id = 'scene_' + Date.now().toString(36);
    state.data.scenes[id] = { name: '新しいシーン', commands: [] };
    state.currentSceneId = id;
    state.openCommandIndex = -1;
    markDirty();
    renderAll();
  }

  function deleteScene(id) {
    const ids = Object.keys(state.data.scenes);
    if (ids.length <= 1) { alert('最後のシーンは削除できません'); return; }
    if (!confirm('シーン「' + (state.data.scenes[id].name || id) + '」を削除しますか？\n(このシーンへのジャンプ/選択肢は無効になります)')) return;
    delete state.data.scenes[id];
    if (state.data.start === id) state.data.start = Object.keys(state.data.scenes)[0];
    if (state.currentSceneId === id) state.currentSceneId = Object.keys(state.data.scenes)[0];
    markDirty();
    renderAll();
  }

  function currentScene() {
    if (!state.data || !state.currentSceneId) return null;
    return state.data.scenes[state.currentSceneId] || null;
  }

  // ---------------------------------------------------------------------
  // コマンド操作
  // ---------------------------------------------------------------------

  function newCommand(type) {
    const def = COMMAND_TYPES[type];
    const cmd = { _id: uid(), type };
    if (def.isChoice) {
      cmd.options = [{ text: '選択肢1', goto: state.data.start, condition: '' }];
    } else {
      for (const f of def.fields) {
        cmd[f.key] = f.default !== undefined ? f.default : (f.type === 'boolean' ? false : (f.type === 'number' ? 0 : ''));
      }
    }
    return cmd;
  }

  function addCommand(type) {
    const scene = currentScene();
    if (!scene) return;
    scene.commands.push(newCommand(type));
    state.openCommandIndex = scene.commands.length - 1;
    markDirty();
    renderAll();
  }

  function deleteCommand(index) {
    const scene = currentScene();
    if (!scene) return;
    scene.commands.splice(index, 1);
    if (state.openCommandIndex === index) state.openCommandIndex = -1;
    markDirty();
    renderSceneEditor();
  }

  function moveCommand(index, dir) {
    const scene = currentScene();
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= scene.commands.length) return;
    const [item] = scene.commands.splice(index, 1);
    scene.commands.splice(newIndex, 0, item);
    if (state.openCommandIndex === index) state.openCommandIndex = newIndex;
    markDirty();
    renderSceneEditor();
  }

  function summarizeCommand(cmd) {
    switch (cmd.type) {
      case 'text': return (cmd.speaker ? '【' + cmd.speaker + '】' : '(地の文) ') + (cmd.body || '');
      case 'bg': return cmd.image || '(未設定)';
      case 'char_show': return (cmd.charId || '?') + ' / ' + (cmd.image || '(未設定)') + ' @ ' + (cmd.position || 'center');
      case 'char_hide': return (cmd.charId || '?') + ' を退場';
      case 'bgm_play': return cmd.file || '(未設定)';
      case 'bgm_stop': return 'BGM停止';
      case 'se_play': return cmd.file || '(未設定)';
      case 'voice_play': return cmd.file || '(未設定)';
      case 'set_var': return (cmd.key || '?') + ' ' + (cmd.op || '=') + ' ' + (cmd.value ?? '');
      case 'choice': return (cmd.options || []).map((o) => o.text).join(' / ');
      case 'jump': return '→ ' + (cmd.target || '?') + (cmd.condition ? '  [条件: ' + cmd.condition + ']' : '');
      case 'end': return 'ゲームを終了してタイトルへ戻る';
      default: return '';
    }
  }

  // ---------------------------------------------------------------------
  // レンダリング: シーン一覧
  // ---------------------------------------------------------------------

  function renderSceneList() {
    const ul = document.getElementById('scene-list');
    ul.innerHTML = '';
    if (!state.data) return;
    for (const id of Object.keys(state.data.scenes)) {
      const scene = state.data.scenes[id];
      const li = document.createElement('li');
      li.className = id === state.currentSceneId ? 'active' : '';
      li.innerHTML = `<span>${escapeHtml(scene.name || id)}</span>` +
        (id === state.data.start ? '<span class="scene-start-badge">START</span>' : '');
      li.addEventListener('click', () => {
        state.currentSceneId = id;
        state.openCommandIndex = -1;
        renderAll();
      });
      ul.appendChild(li);
    }
  }

  // ---------------------------------------------------------------------
  // レンダリング: シーンエディタ(コマンドリスト)
  // ---------------------------------------------------------------------

  function fieldInputHtml(cmd, field, idxPath) {
    const val = cmd[field.key];
    const name = idxPath + '__' + field.key;
    if (field.type === 'text') {
      return `<input type="text" data-field="${field.key}" value="${escapeHtml(val)}" />`;
    }
    if (field.type === 'textarea') {
      return `<textarea data-field="${field.key}" rows="3">${escapeHtml(val)}</textarea>`;
    }
    if (field.type === 'number') {
      return `<input type="number" step="any" data-field="${field.key}" value="${escapeHtml(val)}" />`;
    }
    if (field.type === 'boolean') {
      return `<input type="checkbox" data-field="${field.key}" ${val ? 'checked' : ''} />`;
    }
    if (field.type === 'select') {
      return `<select data-field="${field.key}">` +
        field.options.map((o) => `<option value="${o}" ${o === val ? 'selected' : ''}>${o}</option>`).join('') +
        `</select>`;
    }
    if (field.type.startsWith('asset:')) {
      const cat = field.type.split(':')[1];
      const list = state.assets[cat] || [];
      return `<select data-field="${field.key}">` +
        `<option value="">(未設定)</option>` +
        list.map((f) => `<option value="${f}" ${f === val ? 'selected' : ''}>${f}</option>`).join('') +
        `</select> <button type="button" class="small quick-import" data-cat="${cat}" data-field="${field.key}">素材を追加…</button>`;
    }
    if (field.type === 'charRef') {
      const list = state.data.characters || [];
      return `<select data-field="${field.key}">` +
        `<option value="">(未選択)</option>` +
        list.map((c) => `<option value="${c.id}" ${c.id === val ? 'selected' : ''}>${escapeHtml(c.name)} (${c.id})</option>`).join('') +
        `</select>`;
    }
    if (field.type === 'varRef') {
      const list = state.data.variables || [];
      return `<select data-field="${field.key}">` +
        `<option value="">(未選択)</option>` +
        list.map((v) => `<option value="${v.key}" ${v.key === val ? 'selected' : ''}>${escapeHtml(v.label || v.key)} (${v.key})</option>`).join('') +
        `</select>`;
    }
    if (field.type === 'sceneRef') {
      const scenes = state.data.scenes || {};
      return `<select data-field="${field.key}">` +
        `<option value="">(未選択)</option>` +
        Object.keys(scenes).map((sid) => `<option value="${sid}" ${sid === val ? 'selected' : ''}>${escapeHtml(scenes[sid].name || sid)}</option>`).join('') +
        `</select>`;
    }
    return '';
  }

  function renderCommandForm(cmd) {
    const def = COMMAND_TYPES[cmd.type];
    if (def.isChoice) {
      let html = '<div class="choice-options"></div>';
      const container = document.createElement('div');
      container.innerHTML = '';
      let inner = '';
      (cmd.options || []).forEach((opt, i) => {
        inner += `<div class="choice-option" data-opt-index="${i}">
          <label class="field-label">選択肢 ${i + 1}</label>
          <div class="choice-option-row">
            <input type="text" data-opt-field="text" value="${escapeHtml(opt.text)}" placeholder="選択肢の文言" />
            <button type="button" class="small danger opt-delete">✕</button>
          </div>
          <div class="choice-option-row">
            <label class="muted">移動先:</label>
            <select data-opt-field="goto">
              <option value="">(未選択)</option>
              ${Object.keys(state.data.scenes).map((sid) => `<option value="${sid}" ${sid === opt.goto ? 'selected' : ''}>${escapeHtml(state.data.scenes[sid].name || sid)}</option>`).join('')}
            </select>
          </div>
          <div class="choice-option-row">
            <label class="muted">表示条件:</label>
            <input type="text" data-opt-field="condition" value="${escapeHtml(opt.condition || '')}" placeholder="例: favorability >= 3 (空欄で常に表示)" />
          </div>
        </div>`;
      });
      inner += `<button type="button" class="small add-option">＋ 選択肢を追加</button>`;
      return inner;
    }
    return def.fields.map((f) => `<label class="field-label">${f.label}</label>${fieldInputHtml(cmd, f, cmd._id)}`).join('');
  }

  function renderSceneEditor() {
    const scene = currentScene();
    document.getElementById('scene-name-input').value = scene ? (scene.name || '') : '';
    document.getElementById('scene-id-label').textContent = scene ? '(' + state.currentSceneId + ')' : '';
    document.getElementById('scene-name-input').disabled = !scene;
    document.getElementById('btn-delete-scene').disabled = !scene;

    const listEl = document.getElementById('command-list');
    listEl.innerHTML = '';
    if (!scene) return;

    scene.commands.forEach((cmd, index) => {
      const def = COMMAND_TYPES[cmd.type] || { label: cmd.type };
      const card = document.createElement('div');
      card.className = 'command-card' + (state.openCommandIndex === index ? ' open' : '');

      const summary = document.createElement('div');
      summary.className = 'command-summary';
      summary.innerHTML = `<span class="cmd-type-label">${def.label}</span><span class="cmd-preview">${escapeHtml(summarizeCommand(cmd))}</span>`;
      const actions = document.createElement('div');
      actions.className = 'command-actions';
      actions.innerHTML = `<button type="button" class="small up-btn" title="上へ">↑</button>
        <button type="button" class="small down-btn" title="下へ">↓</button>
        <button type="button" class="small danger del-btn" title="削除">削除</button>`;
      summary.appendChild(actions);
      summary.addEventListener('click', (e) => {
        if (e.target.closest('.command-actions')) return;
        state.openCommandIndex = state.openCommandIndex === index ? -1 : index;
        renderSceneEditor();
      });
      actions.querySelector('.up-btn').addEventListener('click', (e) => { e.stopPropagation(); moveCommand(index, -1); });
      actions.querySelector('.down-btn').addEventListener('click', (e) => { e.stopPropagation(); moveCommand(index, 1); });
      actions.querySelector('.del-btn').addEventListener('click', (e) => { e.stopPropagation(); deleteCommand(index); });

      card.appendChild(summary);

      if (state.openCommandIndex === index) {
        const form = document.createElement('div');
        form.className = 'command-form';
        form.innerHTML = renderCommandForm(cmd);
        bindCommandFormEvents(form, cmd, index);
        card.appendChild(form);
      }
      listEl.appendChild(card);
    });
  }

  function bindCommandFormEvents(form, cmd, index) {
    // 通常フィールド
    form.querySelectorAll('[data-field]').forEach((el) => {
      const key = el.dataset.field;
      const update = () => {
        if (el.type === 'checkbox') cmd[key] = el.checked;
        else if (el.type === 'number') cmd[key] = parseFloat(el.value) || 0;
        else cmd[key] = el.value;
        markDirty();
        updateSummaryOnly(index, cmd);
      };
      el.addEventListener('input', update);
      el.addEventListener('change', update);
    });
    // アセットのクイック取り込み
    form.querySelectorAll('.quick-import').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const cat = btn.dataset.cat;
        const imported = await quickImport(cat);
        if (imported && imported.length) {
          cmd[btn.dataset.field] = imported[0];
          markDirty();
          renderSceneEditor();
        }
      });
    });
    // 選択肢オプション
    form.querySelectorAll('.choice-option').forEach((optEl) => {
      const i = parseInt(optEl.dataset.optIndex, 10);
      optEl.querySelectorAll('[data-opt-field]').forEach((el) => {
        const key = el.dataset.optField;
        const update = () => {
          cmd.options[i][key] = el.value;
          markDirty();
          updateSummaryOnly(index, cmd);
        };
        el.addEventListener('input', update);
        el.addEventListener('change', update);
      });
      const delBtn = optEl.querySelector('.opt-delete');
      if (delBtn) delBtn.addEventListener('click', () => {
        cmd.options.splice(i, 1);
        markDirty();
        renderSceneEditor();
      });
    });
    const addOptBtn = form.querySelector('.add-option');
    if (addOptBtn) addOptBtn.addEventListener('click', () => {
      cmd.options.push({ text: '選択肢' + (cmd.options.length + 1), goto: state.currentSceneId, condition: '' });
      markDirty();
      renderSceneEditor();
    });
  }

  function updateSummaryOnly(index, cmd) {
    const listEl = document.getElementById('command-list');
    const card = listEl.children[index];
    if (!card) return;
    const preview = card.querySelector('.cmd-preview');
    if (preview) preview.textContent = summarizeCommand(cmd);
  }

  async function quickImport(category) {
    if (!state.projectDir) return [];
    const files = await window.api.selectFiles({ title: category + ' 素材を選択' });
    if (!files.length) return [];
    const imported = await window.api.importAssets({ projectDir: state.projectDir, category, filePaths: files });
    await refreshAssets();
    return imported;
  }

  // ---------------------------------------------------------------------
  // サイドパネル: 素材
  // ---------------------------------------------------------------------

  const ASSET_LABELS = { bg: '背景 (bg)', char: '立ち絵 (char)', bgm: 'BGM', se: '効果音 (SE)', voice: 'ボイス' };

  function renderAssetsTab() {
    const el = document.getElementById('tab-assets');
    el.innerHTML = Object.keys(ASSET_LABELS).map((cat) => `
      <div class="asset-category" data-cat="${cat}">
        <h3>${ASSET_LABELS[cat]} <button type="button" class="small import-btn" data-cat="${cat}">＋ 追加</button></h3>
        <ul class="asset-file-list">
          ${(state.assets[cat] || []).map((f) => `<li>${escapeHtml(f)}</li>`).join('') || '<li class="muted">(なし)</li>'}
        </ul>
      </div>
    `).join('');
    el.querySelectorAll('.import-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await quickImport(btn.dataset.cat);
        renderAssetsTab();
        renderSceneEditor();
      });
    });
  }

  // ---------------------------------------------------------------------
  // サイドパネル: キャラクター
  // ---------------------------------------------------------------------

  function renderCharactersTab() {
    const el = document.getElementById('tab-characters');
    const chars = state.data ? state.data.characters : [];
    el.innerHTML = (chars || []).map((c, i) => `
      <div class="list-row" data-i="${i}">
        <input type="text" data-f="id" value="${escapeHtml(c.id)}" placeholder="ID(半角英数)" style="max-width:90px" />
        <input type="text" data-f="name" value="${escapeHtml(c.name)}" placeholder="表示名" />
        <button type="button" class="small danger char-del">✕</button>
      </div>
    `).join('') + `<button type="button" class="small" id="char-add">＋ キャラクターを追加</button>`;

    el.querySelectorAll('.list-row').forEach((row) => {
      const i = parseInt(row.dataset.i, 10);
      row.querySelectorAll('[data-f]').forEach((inp) => {
        inp.addEventListener('input', () => {
          chars[i][inp.dataset.f] = inp.value;
          markDirty();
        });
      });
      row.querySelector('.char-del').addEventListener('click', () => {
        chars.splice(i, 1);
        markDirty();
        renderCharactersTab();
        renderSceneEditor();
      });
    });
    const addBtn = document.getElementById('char-add');
    if (addBtn) addBtn.addEventListener('click', () => {
      chars.push({ id: 'char' + (chars.length + 1), name: '新しいキャラクター' });
      markDirty();
      renderCharactersTab();
    });
  }

  // ---------------------------------------------------------------------
  // サイドパネル: 変数/フラグ
  // ---------------------------------------------------------------------

  function renderVariablesTab() {
    const el = document.getElementById('tab-variables');
    const vars = state.data ? state.data.variables : [];
    el.innerHTML = (vars || []).map((v, i) => `
      <div class="list-row" data-i="${i}">
        <input type="text" data-f="key" value="${escapeHtml(v.key)}" placeholder="変数キー" style="max-width:100px" />
        <input type="text" data-f="label" value="${escapeHtml(v.label || '')}" placeholder="説明" style="max-width:90px" />
        <select data-f="type">
          <option value="number" ${v.type === 'number' ? 'selected' : ''}>数値</option>
          <option value="boolean" ${v.type === 'boolean' ? 'selected' : ''}>真偽値</option>
          <option value="string" ${v.type === 'string' ? 'selected' : ''}>文字列</option>
        </select>
        <input type="text" data-f="default" value="${escapeHtml(v.default)}" placeholder="初期値" style="max-width:70px" />
        <button type="button" class="small danger var-del">✕</button>
      </div>
    `).join('') + `<button type="button" class="small" id="var-add">＋ 変数/フラグを追加</button>`;

    el.querySelectorAll('.list-row').forEach((row) => {
      const i = parseInt(row.dataset.i, 10);
      row.querySelectorAll('[data-f]').forEach((inp) => {
        inp.addEventListener('input', () => {
          let val = inp.value;
          if (inp.dataset.f === 'default') {
            const type = vars[i].type;
            if (type === 'number') val = parseFloat(val) || 0;
            else if (type === 'boolean') val = (val === 'true' || val === '1');
          }
          vars[i][inp.dataset.f] = val;
          markDirty();
        });
      });
      row.querySelector('.var-del').addEventListener('click', () => {
        vars.splice(i, 1);
        markDirty();
        renderVariablesTab();
        renderSceneEditor();
      });
    });
    const addBtn = document.getElementById('var-add');
    if (addBtn) addBtn.addEventListener('click', () => {
      vars.push({ key: 'var' + (vars.length + 1), label: '', type: 'number', default: 0 });
      markDirty();
      renderVariablesTab();
    });
  }

  // ---------------------------------------------------------------------
  // サイドパネル: 作品情報
  // ---------------------------------------------------------------------

  function renderMetaTab() {
    const el = document.getElementById('tab-meta');
    const meta = state.data ? state.data.meta : {};
    el.innerHTML = `
      <label class="field-label">タイトル</label>
      <input type="text" id="meta-title" value="${escapeHtml(meta.title || '')}" />
      <label class="field-label">作者名</label>
      <input type="text" id="meta-author" value="${escapeHtml(meta.author || '')}" />
      <label class="field-label">バージョン</label>
      <input type="text" id="meta-version" value="${escapeHtml(meta.version || '1.0.0')}" />
      <label class="field-label">開始シーン</label>
      <select id="meta-start">
        ${state.data ? Object.keys(state.data.scenes).map((sid) => `<option value="${sid}" ${sid === state.data.start ? 'selected' : ''}>${escapeHtml(state.data.scenes[sid].name || sid)}</option>`).join('') : ''}
      </select>
    `;
    document.getElementById('meta-title').addEventListener('input', (e) => { meta.title = e.target.value; markDirty(); });
    document.getElementById('meta-author').addEventListener('input', (e) => { meta.author = e.target.value; markDirty(); });
    document.getElementById('meta-version').addEventListener('input', (e) => { meta.version = e.target.value; markDirty(); });
    document.getElementById('meta-start').addEventListener('change', (e) => { state.data.start = e.target.value; markDirty(); renderSceneList(); });
  }

  // ---------------------------------------------------------------------
  // 全体再描画
  // ---------------------------------------------------------------------

  function renderAll() {
    renderSceneList();
    renderSceneEditor();
    renderAssetsTab();
    renderCharactersTab();
    renderVariablesTab();
    renderMetaTab();
  }

  // ---------------------------------------------------------------------
  // プレビュー & 出力
  // ---------------------------------------------------------------------

  async function previewGame() {
    if (!state.data) return;
    setStatus('テストプレイを起動しています…');
    await window.api.launchPreview({ projectDir: state.projectDir, data: state.data });
    setStatus('テストプレイを起動しました');
  }

  async function exportGame() {
    if (!state.data) return;
    const outDir = await window.api.selectDirectory({ title: '出力先フォルダを選択(この中にゲームフォルダが作成されます)' });
    if (!outDir) return;
    const folderName = (state.data.meta.title || 'novelgame').replace(/[\\/:*?"<>|]/g, '_');
    const finalOutDir = outDir + (outDir.endsWith('/') || outDir.endsWith('\\') ? '' : '/') + folderName;
    const doZip = confirm('ZIP形式でもまとめて出力しますか？\n(OK: フォルダ+ZIP / キャンセル: フォルダのみ)');
    setStatus('出力しています…');
    try {
      const res = await window.api.exportGame({ projectDir: state.projectDir, data: state.data, outDir: finalOutDir, zip: doZip });
      setStatus('出力が完了しました: ' + res.outDir);
      if (confirm('出力が完了しました。\n' + res.outDir + '\n\nフォルダを開きますか？')) {
        window.api.openPath(res.outDir);
      }
    } catch (e) {
      alert('出力に失敗しました: ' + e.message);
      setStatus('出力に失敗しました');
    }
  }

  // ---------------------------------------------------------------------
  // 初期化
  // ---------------------------------------------------------------------

  function populateAddCommandSelect() {
    const sel = document.getElementById('add-command-type');
    sel.innerHTML = COMMAND_ORDER.map((t) => `<option value="${t}">${COMMAND_TYPES[t].label}</option>`).join('');
  }

  function bindStaticEvents() {
    document.getElementById('btn-new').addEventListener('click', newProject);
    document.getElementById('btn-open').addEventListener('click', openProject);
    document.getElementById('btn-save').addEventListener('click', saveProject);
    document.getElementById('welcome-new').addEventListener('click', newProject);
    document.getElementById('welcome-open').addEventListener('click', openProject);
    document.getElementById('btn-preview').addEventListener('click', previewGame);
    document.getElementById('btn-export').addEventListener('click', exportGame);
    document.getElementById('btn-add-scene').addEventListener('click', addScene);
    document.getElementById('btn-delete-scene').addEventListener('click', () => {
      if (state.currentSceneId) deleteScene(state.currentSceneId);
    });
    document.getElementById('scene-name-input').addEventListener('input', (e) => {
      const scene = currentScene();
      if (scene) { scene.name = e.target.value; markDirty(); renderSceneList(); renderMetaTab(); }
    });
    document.getElementById('btn-add-command').addEventListener('click', () => {
      const type = document.getElementById('add-command-type').value;
      addCommand(type);
    });

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveProject();
      }
    });
    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  function init() {
    populateAddCommandSelect();
    bindStaticEvents();
    document.getElementById('welcome').classList.remove('hidden');
    document.getElementById('main-layout').classList.add('hidden');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
