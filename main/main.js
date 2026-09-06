// main.js — Electronメインプロセス
// エディタ本体のウィンドウ管理、ファイルI/O、アセット取り込み、
// プレビュー/エクスポートのためのIPCハンドラを提供する。

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildExport } = require('./exporter');

const TEMPLATE_DIR = path.join(__dirname, '..', 'player-template');

let mainWindow = null;
const previewWindows = new Set();

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'ノベルゲームエディタ',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// ダイアログ
// ---------------------------------------------------------------------------

ipcMain.handle('dialog:selectDirectory', async (evt, opts = {}) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: opts.title || 'フォルダを選択',
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

ipcMain.handle('dialog:selectFiles', async (evt, opts = {}) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: opts.title || 'ファイルを選択',
    filters: opts.filters || [{ name: 'すべてのファイル', extensions: ['*'] }],
    properties: ['openFile', 'multiSelections']
  });
  if (res.canceled) return [];
  return res.filePaths;
});

ipcMain.handle('dialog:selectProjectFile', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'プロジェクトを開く',
    filters: [{ name: 'ノベルゲームプロジェクト', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

// ---------------------------------------------------------------------------
// プロジェクトの作成/読込/保存
// ---------------------------------------------------------------------------

const ASSET_CATEGORIES = ['bg', 'char', 'bgm', 'se', 'voice'];

function defaultProjectData(title) {
  return {
    meta: { title: title || '無題のノベルゲーム', author: '', version: '1.0.0' },
    variables: [],
    characters: [],
    scenes: {
      scene1: { name: '第1章', commands: [] }
    },
    start: 'scene1'
  };
}

ipcMain.handle('project:create', async (evt, { dir, title }) => {
  if (!dir) throw new Error('保存先フォルダが指定されていません');
  fs.mkdirSync(dir, { recursive: true });
  for (const cat of ASSET_CATEGORIES) {
    fs.mkdirSync(path.join(dir, 'assets', cat), { recursive: true });
  }
  const data = defaultProjectData(title);
  const projectPath = path.join(dir, 'project.json');
  if (fs.existsSync(projectPath)) {
    throw new Error('このフォルダには既にプロジェクトが存在します');
  }
  fs.writeFileSync(projectPath, JSON.stringify(data, null, 2), 'utf-8');
  return { projectDir: dir, projectPath, data };
});

ipcMain.handle('project:open', async (evt, { projectPath }) => {
  const raw = fs.readFileSync(projectPath, 'utf-8');
  const data = JSON.parse(raw);
  const projectDir = path.dirname(projectPath);
  for (const cat of ASSET_CATEGORIES) {
    fs.mkdirSync(path.join(projectDir, 'assets', cat), { recursive: true });
  }
  return { projectDir, projectPath, data };
});

ipcMain.handle('project:save', async (evt, { projectPath, data }) => {
  fs.writeFileSync(projectPath, JSON.stringify(data, null, 2), 'utf-8');
  return true;
});

// ---------------------------------------------------------------------------
// アセット管理
// ---------------------------------------------------------------------------

ipcMain.handle('assets:import', async (evt, { projectDir, category, filePaths }) => {
  if (!ASSET_CATEGORIES.includes(category)) throw new Error('不明なカテゴリ: ' + category);
  const destDir = path.join(projectDir, 'assets', category);
  fs.mkdirSync(destDir, { recursive: true });
  const imported = [];
  for (const src of filePaths) {
    let name = path.basename(src);
    let dest = path.join(destDir, name);
    // 同名ファイルがある場合は連番を付与
    let counter = 1;
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    while (fs.existsSync(dest)) {
      name = `${base}_${counter}${ext}`;
      dest = path.join(destDir, name);
      counter += 1;
    }
    fs.copyFileSync(src, dest);
    imported.push(name);
  }
  return imported;
});

ipcMain.handle('assets:list', async (evt, { projectDir }) => {
  const result = {};
  for (const cat of ASSET_CATEGORIES) {
    const dir = path.join(projectDir, 'assets', cat);
    result[cat] = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => !f.startsWith('.'))
      : [];
  }
  return result;
});

ipcMain.handle('assets:reveal', async (evt, { projectDir, category }) => {
  const dir = path.join(projectDir, 'assets', category || '');
  shell.openPath(dir);
});

// ---------------------------------------------------------------------------
// プレビュー(テストプレイ)
// ---------------------------------------------------------------------------

ipcMain.handle('preview:launch', async (evt, { projectDir, data }) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-preview-'));
  const { outDir } = buildExport({ projectDir, projectData: data, outDir: tmpDir, templateDir: TEMPLATE_DIR });

  const win = new BrowserWindow({
    width: 960,
    height: 640,
    title: 'テストプレイ — ' + ((data.meta && data.meta.title) || ''),
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(outDir, 'index.html'));
  previewWindows.add(win);
  win.on('closed', () => {
    previewWindows.delete(win);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  return true;
});

// ---------------------------------------------------------------------------
// エクスポート(出力)
// ---------------------------------------------------------------------------

ipcMain.handle('export:game', async (evt, { projectDir, data, outDir, zip }) => {
  const result = buildExport({ projectDir, projectData: data, outDir, templateDir: TEMPLATE_DIR });
  let zipPath = null;
  if (zip) {
    zipPath = outDir.replace(/[\\/]+$/, '') + '.zip';
    await zipDirectory(result.outDir, zipPath);
  }
  return { outDir: result.outDir, zipPath };
});

ipcMain.handle('shell:openPath', async (evt, targetPath) => {
  shell.openPath(targetPath);
});

async function zipDirectory(srcDir, zipPath) {
  const archiver = require('archiver');
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(srcDir, false);
    archive.finalize();
  });
}
