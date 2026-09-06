// exporter.js
// プロジェクトデータ(project.json相当)を「単体で再生可能なノベルゲーム」に書き出す処理。
// エディタ本体のプレビュー機能と、ユーザー向けの「出力(エクスポート)」機能の両方から
// 同じロジックを共有することで、プレビューとエクスポート結果の整合性を保つ。

const fs = require('fs');
const path = require('path');

/**
 * ディレクトリを再帰的にコピーする。
 */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

/**
 * エディタ用プロジェクトデータから、プレイヤー(ランタイム)が読み込む
 * ゲームデータのみを抽出する。エディタ内部だけで使う情報(選択中のシーンIDなど)は含めない。
 */
function compileProjectData(projectData) {
  return {
    meta: {
      title: (projectData.meta && projectData.meta.title) || '無題のノベルゲーム',
      author: (projectData.meta && projectData.meta.author) || '',
      version: (projectData.meta && projectData.meta.version) || '1.0.0',
      // セーブデータのキーを他のゲームと衝突させないための識別子
      saveId: (projectData.meta && projectData.meta.saveId) || slugify((projectData.meta && projectData.meta.title) || 'novelgame')
    },
    variables: projectData.variables || [],
    characters: projectData.characters || [],
    scenes: projectData.scenes || {},
    start: projectData.start || null
  };
}

function slugify(str) {
  return 'vn_' + String(str)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9぀-ヿ一-鿿_-]+/g, '_')
    .slice(0, 40) || 'vn_game';
}

/**
 * 出力(エクスポート)本体。
 * @param {object} opts
 * @param {string} opts.projectDir  プロジェクトフォルダの絶対パス(assets/を含む)
 * @param {object} opts.projectData プロジェクトのJSONデータ
 * @param {string} opts.outDir      出力先フォルダの絶対パス(存在すれば中身は上書きされる)
 * @param {string} opts.templateDir player-templateフォルダの絶対パス
 */
function buildExport({ projectDir, projectData, outDir, templateDir }) {
  if (!fs.existsSync(templateDir)) {
    throw new Error('プレイヤーテンプレートが見つかりません: ' + templateDir);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // 1. プレイヤー(ランタイム)一式をコピー
  copyDir(templateDir, outDir);

  // 2. アセット(背景/立ち絵/BGM/SE/ボイス)をコピー
  const assetsSrc = path.join(projectDir, 'assets');
  const assetsDest = path.join(outDir, 'assets');
  if (fs.existsSync(assetsSrc)) {
    copyDir(assetsSrc, assetsDest);
  } else {
    fs.mkdirSync(assetsDest, { recursive: true });
  }

  // 3. シナリオデータを data.js として書き出す
  //    (file:// で直接開いた際に fetch() が CORS で失敗しないよう、
  //     <script>タグで読み込めるJSとして埋め込む)
  const compiled = compileProjectData(projectData);
  const jsDir = path.join(outDir, 'js');
  fs.mkdirSync(jsDir, { recursive: true });
  const dataJs = '// このファイルは自動生成されます。エディタで編集してください。\n' +
    'window.GAME_DATA = ' + JSON.stringify(compiled, null, 2) + ';\n';
  fs.writeFileSync(path.join(jsDir, 'data.js'), dataJs, 'utf-8');

  return { outDir, compiled };
}

module.exports = { buildExport, copyDir, compileProjectData, slugify };
