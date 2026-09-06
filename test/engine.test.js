// engine.test.js — jsdom を使って、書き出したノベルゲーム(player-template実行結果)が
// 実際にブラウザ相当の環境で動作するかを検証する自己完結スクリプト。
// テスト用のサンプルプロジェクトと書き出し結果はこのスクリプト自身が一時フォルダに
// 生成するため、クローン直後やCI環境でも `npm run test:engine` だけで実行できる。
// 実行: node test/engine.test.js

const path = require('path');
const fs = require('fs');
const os = require('os');
const { JSDOM } = require('jsdom');
const assert = require('assert');
const { buildExport } = require('../main/exporter');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function buildSampleExport() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-engine-test-'));
  const projectDir = path.join(workDir, 'project');
  const outDir = path.join(workDir, 'export');
  for (const cat of ['bg', 'char', 'bgm', 'se', 'voice']) {
    fs.mkdirSync(path.join(projectDir, 'assets', cat), { recursive: true });
  }
  fs.writeFileSync(path.join(projectDir, 'assets', 'bg', 'room.png'), 'PNGDATA');
  fs.writeFileSync(path.join(projectDir, 'assets', 'char', 'yui_smile.png'), 'PNGDATA');

  const projectData = {
    meta: { title: 'テスト小説', author: 'テスター', version: '1.0.0' },
    variables: [{ key: 'favorability', label: '好感度', type: 'number', default: 0 }],
    characters: [{ id: 'yui', name: '唯' }],
    scenes: {
      scene1: {
        name: '第1章',
        commands: [
          { type: 'bg', image: 'room.png', transition: 'fade', duration: 0.5 },
          { type: 'char_show', charId: 'yui', image: 'yui_smile.png', position: 'center', transition: 'fade', duration: 0.4 },
          { type: 'text', speaker: '唯', body: 'こんにちは！' },
          { type: 'set_var', key: 'favorability', op: '+=', valueType: 'number', value: 1 },
          {
            type: 'choice',
            options: [
              { text: '元気だよ', goto: 'scene2', condition: '' },
              { text: '疲れた', goto: 'scene3', condition: 'favorability >= 5' }
            ]
          }
        ]
      },
      scene2: { name: '第2章A', commands: [{ type: 'text', speaker: '唯', body: 'よかった！' }, { type: 'end' }] },
      scene3: { name: '第2章B', commands: [{ type: 'text', speaker: '唯', body: '大丈夫？' }, { type: 'end' }] }
    },
    start: 'scene1'
  };

  const templateDir = path.join(__dirname, '..', 'player-template');
  buildExport({ projectDir, projectData, outDir, templateDir });
  return { workDir, outDir };
}

async function main() {
  const { workDir, outDir: EXPORT_DIR } = buildSampleExport();
  const html = fs.readFileSync(path.join(EXPORT_DIR, 'index.html'), 'utf-8');
  const dom = new JSDOM(html, {
    url: 'file://' + EXPORT_DIR + '/index.html',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true
  });
  const { window } = dom;

  // jsdomのfile://オリジンではlocalStorageアクセスがSecurityErrorになる場合があるが、
  // これはengine.js内のstorageGet/storageSetが自動的にメモリストアへフォールバックするため、
  // テスト側では素通りさせて実際のフォールバック挙動ごと検証する。

  // 未実装機能(HTMLMediaElement.play など)のエラーを握りつぶす
  window.addEventListener('error', () => {});

  await new Promise((resolve) => {
    window.document.addEventListener('DOMContentLoaded', () => setTimeout(resolve, 20));
  });

  const doc = window.document;

  // --- 1. タイトル画面の初期状態 ---
  assert.ok(!doc.getElementById('screen-title').classList.contains('hidden'), 'タイトル画面が表示されている');
  assert.strictEqual(doc.getElementById('game-title').textContent, 'テスト小説', 'タイトルが正しく表示される');
  assert.ok(doc.getElementById('btn-continue').disabled, 'セーブが無い状態ではつづきからが無効');
  console.log('OK: タイトル画面初期状態');

  // --- 2. 新規ゲーム開始 ---
  doc.getElementById('btn-newgame').dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(50);
  assert.ok(!doc.getElementById('screen-game').classList.contains('hidden'), 'ゲーム画面に遷移した');
  console.log('OK: 新規ゲーム開始 → ゲーム画面表示');

  // --- 3. 背景・キャラクター表示のフェード(bg:0.5s + char:0.4s)完了を待って、テキスト表示まで進める ---
  await sleep(1200);
  doc.getElementById('screen-game').dispatchEvent(new window.Event('click', { bubbles: true })); // タイプ中なら即時完了
  await sleep(50);
  doc.getElementById('screen-game').dispatchEvent(new window.Event('click', { bubbles: true })); // 次へ進める(set_varコマンドを経て選択肢へ)
  await sleep(50);

  const bodyText = doc.getElementById('text-body').textContent;
  assert.strictEqual(bodyText, 'こんにちは！', '本文が正しく表示される: ' + bodyText);
  console.log('OK: セリフ表示 "' + bodyText + '"');

  const bg = doc.getElementById('bg-image');
  assert.ok(bg.src.endsWith('assets/bg/room.png'), '背景画像が正しいパスに設定される: ' + bg.src);
  console.log('OK: 背景画像パス ' + bg.src);

  const charImg = doc.querySelector('.char-img[data-pos="center"]');
  assert.ok(charImg.src.endsWith('assets/char/yui_smile.png'), '立ち絵が正しいパスに設定される: ' + charImg.src);
  console.log('OK: 立ち絵パス ' + charImg.src);

  // --- 4. 選択肢が表示されているはず(set_varにより favorability=1) ---
  await sleep(50);
  const choiceLayer = doc.getElementById('choice-layer');
  assert.ok(!choiceLayer.classList.contains('hidden'), '選択肢が表示されている');
  const buttons = Array.from(choiceLayer.querySelectorAll('button'));
  console.log('選択肢:', buttons.map((b) => b.textContent));
  // favorability(=1) < 5 なので「疲れた」(条件 favorability>=5)は表示されないはず
  assert.strictEqual(buttons.length, 1, '条件を満たさない選択肢は表示されない(1個のみ表示)');
  assert.strictEqual(buttons[0].textContent, '元気だよ');
  console.log('OK: 条件付き選択肢のフィルタリングが正しく機能');

  // --- 5. 選択肢をクリックしてscene2へ分岐 ---
  buttons[0].dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(80);
  doc.getElementById('screen-game').dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(30);
  const text2 = doc.getElementById('text-body').textContent;
  assert.strictEqual(text2, 'よかった！', 'scene2のテキストが表示される: ' + text2);
  console.log('OK: 選択肢分岐によりscene2へ遷移');

  // --- 6. セーブ ---
  doc.getElementById('btn-save').dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(30);
  const grid = doc.getElementById('save-slot-grid');
  assert.ok(!doc.getElementById('saveload-overlay').classList.contains('hidden'), 'セーブ画面が開いている');
  const slot1 = grid.querySelector('.save-slot');
  slot1.dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(30);
  console.log('OK: スロット1にセーブ');

  const slotLabelAfterSave = grid.querySelector('.save-slot .slot-label');
  assert.ok(slotLabelAfterSave, 'セーブ後、スロットにラベルが表示される');
  assert.strictEqual(slotLabelAfterSave.textContent, '第2章A', 'セーブされたシーン名が表示される: ' + slotLabelAfterSave.textContent);
  console.log('OK: セーブ後のスロット表示確認 (label=' + slotLabelAfterSave.textContent + ')');

  doc.getElementById('btn-saveload-close').dispatchEvent(new window.Event('click', { bubbles: true }));

  // --- 7. タイトルに戻ってロード ---
  window.confirm = () => true; // タイトルへ戻る確認ダイアログをOK扱いに
  doc.getElementById('btn-title').dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(30);
  assert.ok(!doc.getElementById('screen-title').classList.contains('hidden'), 'タイトル画面に戻った');
  assert.ok(!doc.getElementById('btn-continue').disabled, 'セーブがあるのでつづきからが有効になる');
  console.log('OK: タイトルへ戻り、つづきからボタンが有効化');

  doc.getElementById('btn-loadgame').dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(30);
  const loadSlot = doc.getElementById('save-slot-grid').querySelector('.save-slot');
  loadSlot.dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(50);
  assert.ok(!doc.getElementById('screen-game').classList.contains('hidden'), 'ロード後ゲーム画面に戻った');
  const restoredBg = doc.getElementById('bg-image');
  assert.ok(restoredBg.src.endsWith('assets/bg/room.png'), 'ロード後も背景が復元される');
  console.log('OK: ロードによる状態復元(背景・シーン)');

  console.log('\n=== 全テスト成功 ===');
  window.close();
  fs.rmSync(workDir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error('テスト失敗:', e && e.name, e && e.message);
  console.error(e && e.stack);
  process.exit(1);
});
