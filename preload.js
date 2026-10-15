const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('copilot', {
  // Text question → Claude
  sendQuestion: (text) => ipcRenderer.invoke('send-question', text),

  // Screen capture → base64 PNG
  captureScreen: () => ipcRenderer.invoke('capture-screen'),

  // Send screenshot to Claude for vision answer
  answerFromScreenshot: (dataUrl) => ipcRenderer.invoke('answer-from-screenshot', dataUrl),

  // Settings
  checkConfig:    ()     => ipcRenderer.invoke('check-config'),
  getConfig:      ()     => ipcRenderer.invoke('get-config'),
  saveConfig:     (data) => ipcRenderer.invoke('save-config', data),

  // Interview mode — hides the main window so proctoring can't see it
  hideMainWindow: ()     => ipcRenderer.invoke('hide-main-window'),

  // Global hotkey fired capture shortcut
  onHotkeyCapture: (cb) => ipcRenderer.on('hotkey-capture', () => cb()),

  // Callbacks
  onQuestionReceived: (cb) => ipcRenderer.on('question-received', (_e, text)  => cb(text)),
  onQuestionType:     (cb) => ipcRenderer.on('question-type',     (_e, type)  => cb(type)),
  onAnswerChunk:      (cb) => ipcRenderer.on('answer-chunk',      (_e, chunk) => cb(chunk)),
  onAnswerDone:       (cb) => ipcRenderer.on('answer-done',       ()          => cb()),
});
