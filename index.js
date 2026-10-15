const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, safeStorage, screen } = require('electron');

app.commandLine.appendSwitch('log-level', '3');

const path   = require('path');
const fs     = require('fs');
const { spawn } = require('child_process');
const OpenAI = require('openai');
const defaultConfig = require('./config');
const { classify, PROMPTS } = require('./classifier');

// Mutable config — can be overridden by saved settings
let currentConfig = { ...defaultConfig, model: 'claude-sonnet-4-6' };
let aiClient = null;
let settingsPath = null;

function initClient() {
  aiClient = new OpenAI({ baseURL: currentConfig.baseURL, apiKey: currentConfig.apiKey });
}

let overlayWindow = null;
let mainWindow    = null;

// ── Conversation history ──────────────────────────────────────────────────────
const MAX_HISTORY = 10;
const conversationHistory = [];

function addToHistory(role, content) {
  conversationHistory.push({ role, content });
  if (conversationHistory.length > MAX_HISTORY)
    conversationHistory.splice(0, conversationHistory.length - MAX_HISTORY);
}

// ── Claude streaming ──────────────────────────────────────────────────────────
async function generateAnswer(question) {
  addToHistory('user', question);
  let fullAnswer = '';

  // Classify the question and pick the right system prompt
  const type = classify(question);
  if (mainWindow) mainWindow.webContents.send('question-type', type);

  const stream = await aiClient.chat.completions.create({
    model: currentConfig.model,
    messages: [{ role: 'system', content: PROMPTS[type] }, ...conversationHistory],
    stream: true,
  });

  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content ?? '';
    if (!token) continue;
    fullAnswer += token;
    if (mainWindow)    mainWindow.webContents.send('answer-chunk', token);
    if (overlayWindow) overlayWindow.webContents.send('answer-chunk', token);
  }

  addToHistory('assistant', fullAnswer);
  return fullAnswer;
}

// ── Shared pipeline: question → Claude ───────────────────────────────────────
async function handleQuestion(question) {
  if (!question?.trim()) return;
  if (mainWindow)    mainWindow.webContents.send('question-received', question);
  if (overlayWindow) overlayWindow.webContents.send('question-received', question);

  try {
    await generateAnswer(question);
    if (mainWindow)    mainWindow.webContents.send('answer-done');
    if (overlayWindow) overlayWindow.webContents.send('answer-done');
  } catch (err) {
    const msg = `Answer failed: ${err.message}`;
    console.error(msg);
    [mainWindow, overlayWindow].forEach(w => {
      if (w) { w.webContents.send('answer-chunk', msg); w.webContents.send('answer-done'); }
    });
  }
}

// ── IPC: manual text question ─────────────────────────────────────────────────
ipcMain.handle('send-question', (_e, q) => handleQuestion(q));

// ── Screen capture helpers ────────────────────────────────────────────────────

// Samples every 4th pixel; returns true when >75% are nearly black.
// Used to detect captures where a protected window blocked content.
function isImageMostlyBlack(nativeImg) {
  try {
    const { width, height } = nativeImg.getSize();
    if (!width || !height) return true;
    const buf = nativeImg.getBitmap();  // raw BGRA bytes
    let dark = 0;
    const step = 16;  // check every 4th pixel (4 bytes each)
    const samples = Math.floor(buf.length / step);
    for (let i = 0; i < buf.length; i += step) {
      if (buf[i] < 20 && buf[i + 1] < 20 && buf[i + 2] < 20) dark++;
    }
    return dark / samples > 0.75;
  } catch { return false; }
}

// GDI fallback: uses Windows GDI CopyFromScreen (different graphics pipeline
// from DXGI; captures some windows that appear black in the standard method).
function captureWithGDI() {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(app.getPath('temp'), `copilot_${Date.now()}.png`);
    const ps = tmpFile.replace(/\\/g, '\\\\');  // escape for single-quoted PS string

    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type -AssemblyName System.Drawing',
      '$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
      '$bmp = New-Object System.Drawing.Bitmap($s.Width, $s.Height)',
      '$g   = [System.Drawing.Graphics]::FromImage($bmp)',
      '$g.CopyFromScreen($s.Left, $s.Top, 0, 0, $bmp.Size, ' +
        '[System.Drawing.CopyPixelOperation]::SourceCopy)',
      `$bmp.Save('${ps}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      '$g.Dispose(); $bmp.Dispose()',
    ].join('; ');

    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script,
    ]);
    let stderr = '';
    child.stderr.on('data', d => stderr += d.toString());
    child.on('close', code => {
      if (code !== 0) { reject(new Error(stderr.trim() || `GDI exit ${code}`)); return; }
      try {
        const data = fs.readFileSync(tmpFile);
        try { fs.unlinkSync(tmpFile); } catch {}
        resolve('data:image/png;base64,' + data.toString('base64'));
      } catch (e) { reject(e); }
    });
  });
}

// ── IPC: capture primary screen → return base64 PNG ──────────────────────────
// Strategy: try Electron DXGI first; if the result looks mostly black (a sign
// that a protected window blocked capture), fall back to GDI via PowerShell.
ipcMain.handle('capture-screen', async () => {
  // Only hide — and later restore — if the window was visible to begin with.
  // If the user already hid the main window for interview mode, leave it hidden.
  const wasVisible = mainWindow?.isVisible() ?? false;
  try {
    if (wasVisible) mainWindow.hide();
    await new Promise(r => setTimeout(r, 350));  // let OS redraw without our window

    let dataUrl = null;
    let method  = 'dxgi';

    // ── Method 1: Electron DXGI (fast, works for most apps) ──
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
      });
      if (sources.length) {
        const img = sources[0].thumbnail;
        if (!isImageMostlyBlack(img)) {
          dataUrl = img.toDataURL();
        } else {
          console.log('[capture] DXGI image mostly black — trying GDI fallback');
        }
      }
    } catch (e) {
      console.warn('[capture] DXGI failed:', e.message);
    }

    // ── Method 2: GDI via PowerShell (different graphics path) ──
    if (!dataUrl) {
      try {
        dataUrl = await captureWithGDI();
        method  = 'gdi';
        console.log('[capture] GDI capture succeeded');
      } catch (e) {
        console.error('[capture] GDI also failed:', e.message);
      }
    }

    if (wasVisible) mainWindow.show();
    if (!dataUrl) return { ok: false, error: 'All capture methods failed. The active window may use system-level display protection.' };
    return { ok: true, dataUrl, method };
  } catch (err) {
    if (wasVisible && mainWindow) mainWindow.show();
    return { ok: false, error: err.message };
  }
});

// ── IPC: send screenshot to Claude for vision analysis + answer ───────────────
ipcMain.handle('answer-from-screenshot', async (_e, dataUrl) => {
  const label = '[Screen capture]';
  if (mainWindow)    mainWindow.webContents.send('question-received', label);
  if (overlayWindow) overlayWindow.webContents.send('question-received', label);

  try {
    await generateAnswerFromImage(dataUrl);
    if (mainWindow)    mainWindow.webContents.send('answer-done');
    if (overlayWindow) overlayWindow.webContents.send('answer-done');
  } catch (err) {
    console.error('Vision error:', err.message);
    const msg = `Vision failed: ${err.message}`;
    [mainWindow, overlayWindow].forEach(w => {
      if (w) { w.webContents.send('answer-chunk', msg); w.webContents.send('answer-done'); }
    });
  }
});

async function generateAnswerFromImage(dataUrl) {
  // Vision message: image + instruction — NOT added to history (too large)
  const visionMessage = {
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: dataUrl } },
      {
        type: 'text',
        text: 'This is a screenshot from my interview screen. In one sentence state the question you see, then give a complete, well-structured answer as the candidate.',
      },
    ],
  };

  let fullAnswer = '';
  const stream = await aiClient.chat.completions.create({
    model: currentConfig.model,
    messages: [
      { role: 'system', content: PROMPTS.screen },
      ...conversationHistory,
      visionMessage,
    ],
    stream: true,
  });

  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content ?? '';
    if (!token) continue;
    fullAnswer += token;
    if (mainWindow)    mainWindow.webContents.send('answer-chunk', token);
    if (overlayWindow) overlayWindow.webContents.send('answer-chunk', token);
  }

  // Store a text-only summary in history so follow-up questions have context
  addToHistory('user', 'Please answer the question on my screen.');
  addToHistory('assistant', fullAnswer);
  return fullAnswer;
}

// ── Settings persistence helpers ──────────────────────────────────────────────
function loadSavedSettings() {
  if (!settingsPath || !fs.existsSync(settingsPath)) return;
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (saved.baseURL) currentConfig.baseURL = saved.baseURL;
    if (saved.model)   currentConfig.model   = saved.model;
    // Prefer encrypted key; fall back to plain text for migration
    if (saved.apiKeyEncrypted && safeStorage.isEncryptionAvailable()) {
      currentConfig.apiKey = safeStorage.decryptString(
        Buffer.from(saved.apiKeyEncrypted, 'base64')
      );
    } else if (saved.apiKey) {
      currentConfig.apiKey = saved.apiKey;
    }
  } catch (e) { console.error('Settings load error:', e.message); }
}

function persistSettings() {
  const toSave = { baseURL: currentConfig.baseURL, model: currentConfig.model };
  if (currentConfig.apiKey) {
    if (safeStorage.isEncryptionAvailable()) {
      toSave.apiKeyEncrypted = safeStorage.encryptString(currentConfig.apiKey).toString('base64');
    } else {
      toSave.apiKey = currentConfig.apiKey;   // plain text fallback
    }
  }
  fs.writeFileSync(settingsPath, JSON.stringify(toSave, null, 2));
}

// ── IPC: settings ─────────────────────────────────────────────────────────────

// Returns safe subset — never exposes the raw API key to the renderer
ipcMain.handle('get-config', () => ({
  baseURL:   currentConfig.baseURL   || '',
  model:     currentConfig.model     || 'claude-sonnet-4-6',
  apiKeySet: !!currentConfig.apiKey,
}));

// Quick check used on startup to decide whether to show the config prompt
ipcMain.handle('check-config', () => ({
  configured: !!(currentConfig.apiKey && currentConfig.baseURL),
}));

// Hides the main window so interview proctoring (Micro1, HireVue, etc.) can't
// see the Copilot control panel. Ctrl+Shift+S and overlay still work normally.
ipcMain.handle('hide-main-window', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle('save-config', (_e, data) => {
  if (data.baseURL) currentConfig.baseURL = data.baseURL.trim();
  if (data.model)   currentConfig.model   = data.model.trim();
  if (data.apiKey)  currentConfig.apiKey  = data.apiKey.trim();   // empty → keep existing
  try {
    persistSettings();
    initClient();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Windows ───────────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900, height: 750,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  mainWindow.loadFile('index.html');
}

function createOverlayWindow() {
  // Position overlay on the right side of the screen so it doesn't cover
  // the interviewer's camera feed that most platforms show on the left.
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const ow = 680, oh = Math.floor(sh * 0.55);

  overlayWindow = new BrowserWindow({
    width: ow, height: oh,
    x: sw - ow - 16, y: 16,   // right side, 16px margin
    transparent: true, frame: false,
    show: false, skipTaskbar: true, resizable: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  overlayWindow.loadFile('overlay.html');

  // 'screen-saver' level keeps the overlay above full-screen browser windows
  // (e.g. Micro1, HireVue, CoderPad in full-screen mode).
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');

  // Hide the overlay from screen-sharing tools (Zoom, Meet, Teams, Micro1
  // proctoring) while keeping it visible on the user's physical monitor.
  overlayWindow.setContentProtection(true);

  overlayWindow.on('close', e => { e.preventDefault(); overlayWindow.hide(); });
}

app.whenReady().then(() => {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  loadSavedSettings();
  initClient();
  createMainWindow();
  createOverlayWindow();

  // Toggle overlay (invisible to screen sharing)
  globalShortcut.register('Ctrl+Shift+H', () => {
    if (!overlayWindow) return;
    overlayWindow.isVisible() ? overlayWindow.hide() : overlayWindow.show();
  });

  // Capture screen from anywhere — works even when main window is hidden
  globalShortcut.register('Ctrl+Shift+S', async () => {
    if (mainWindow) mainWindow.webContents.send('hotkey-capture');
  });

  // Toggle main window visibility — use this before starting an interview
  // so the Copilot control panel is hidden from Micro1/HireVue proctoring.
  // Ctrl+Shift+S and Ctrl+Shift+H continue to work while main window is hidden.
  globalShortcut.register('Ctrl+Shift+M', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
