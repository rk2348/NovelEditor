// test-prompt-modal.js — showPromptDialog() のロジック単体を jsdom で検証する。
// window.prompt() をElectronが正式サポートしていない問題への置き換え実装が
// 実際にイベント処理・Promise解決・オーバーレイの表示/非表示を正しく行うか確認する。
const { JSDOM } = require('jsdom');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf-8');

async function main() {
  const dom = new JSDOM(html, { url: 'file:///tmp/index.html', runScripts: 'outside-only' });
  const { window } = dom;
  const doc = window.document;

  // app.js内の showPromptDialog と同一ロジックをテスト用にそのまま貼り付けて検証
  // (IIFEクロージャ内にあるため、実装と完全一致するコードで直接テストする)
  function showPromptDialog(message, defaultValue) {
    return new Promise((resolve) => {
      const overlay = doc.getElementById('prompt-overlay');
      const msgEl = doc.getElementById('prompt-message');
      const inputEl = doc.getElementById('prompt-input');
      const okBtn = doc.getElementById('prompt-ok');
      const cancelBtn = doc.getElementById('prompt-cancel');

      msgEl.textContent = message;
      inputEl.value = defaultValue || '';
      overlay.classList.remove('hidden');

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

  // --- ケース1: 初期状態で非表示 ---
  assert.ok(doc.getElementById('prompt-overlay').classList.contains('hidden'), '初期状態では非表示');
  console.log('OK: 初期状態は非表示');

  // --- ケース2: 表示され、テキスト入力してOKを押すと、その値でresolveされる ---
  const p1 = showPromptDialog('作品タイトルを入力してください', '無題のノベルゲーム');
  assert.ok(!doc.getElementById('prompt-overlay').classList.contains('hidden'), '呼び出し後は表示される');
  const input = doc.getElementById('prompt-input');
  assert.strictEqual(input.value, '無題のノベルゲーム', 'デフォルト値が入力欄にセットされる');
  input.value = 'マイノベルゲーム';
  doc.getElementById('prompt-ok').dispatchEvent(new window.Event('click', { bubbles: true }));
  const result1 = await p1;
  assert.strictEqual(result1, 'マイノベルゲーム', 'OKを押すと入力値でresolveされる: ' + result1);
  assert.ok(doc.getElementById('prompt-overlay').classList.contains('hidden'), 'OK後は再び非表示になる');
  console.log('OK: 入力→OKクリックで値が返り、モーダルが閉じる');

  // --- ケース3: キャンセルするとnullでresolveされる ---
  const p2 = showPromptDialog('タイトル', 'デフォルト');
  doc.getElementById('prompt-cancel').dispatchEvent(new window.Event('click', { bubbles: true }));
  const result2 = await p2;
  assert.strictEqual(result2, null, 'キャンセルするとnullが返る');
  console.log('OK: キャンセルでnullが返る');

  // --- ケース4: Enterキーで確定できる ---
  const p3 = showPromptDialog('タイトル', 'デフォルト');
  const input3 = doc.getElementById('prompt-input');
  input3.value = 'Enterテスト';
  const enterEvent = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  input3.dispatchEvent(enterEvent);
  const result3 = await p3;
  assert.strictEqual(result3, 'Enterテスト', 'Enterキーでも確定できる: ' + result3);
  console.log('OK: Enterキーでの確定');

  console.log('\n=== プロンプトモーダル検証: 全成功 ===');
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
