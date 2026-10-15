# Interview Copilot

A desktop app built with Electron that gives you real-time AI-powered answers during technical interviews. Type a question or capture your screen, and Claude streams a structured answer into a floating overlay that is invisible to screen-sharing tools like Zoom, Google Meet, and Microsoft Teams.

---

## Features

- **Screen capture** — captures the interview screen and sends it to Claude for analysis
- **Streaming answers** — responses stream word-by-word with markdown and IDE-style syntax highlighting for code
- **Invisible overlay** — a transparent, always-on-top panel that screen-sharing software cannot see
- **Question classifier** — automatically detects coding, behavioural, ML/AI, or general questions and adjusts the prompt
- **Candidate profile** — answers are personalised to the candidate's actual CV, projects, and experience
- **Interview Mode** — hides the control panel from proctoring tools with one click
- **Settings panel** — update API key, base URL, and model at runtime; key is encrypted with OS-level storage
- **Font size controls** — resize overlay text on the fly
- **Smart scroll** — auto-scrolls during streaming but stays put if you scroll up to re-read

---

## Hotkeys

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+H` | Show / hide overlay |
| `Ctrl+Shift+S` | Capture screen and ask Claude |
| `Ctrl+Shift+M` | Hide / restore main window (interview mode) |

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- An API key for a Claude-compatible gateway (OpenAI-format `/v1/chat/completions`)

---

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/peprah12git/Interview-Copilot.git
cd Interview-Copilot

# 2. Install dependencies
npm install

# 3. Create your config file (never commit this)
```

Create `config.js` in the project root:

```js
module.exports = {
  baseURL: 'https://your-gateway.example.com/v1',
  apiKey:  'sk-your-api-key-here',
};
```

You can also set these values inside the app via **⚙ Settings** after launch — the key will be encrypted and saved locally.

```bash
# 4. Run the app
npm start
```

---

## Usage

1. Launch the app — the main control panel opens
2. Press `Ctrl+Shift+H` to show the overlay (position it where you want on screen)
3. Click **Interview Mode** or press `Ctrl+Shift+M` to hide the control panel during the interview
4. When a question appears on your screen, click **📷 Capture Screen** on the overlay (or press `Ctrl+Shift+S`)
5. Claude's answer streams into the overlay — scroll with the mouse wheel or arrow keys

For text questions, type directly into the main panel and press `Enter`.

---

## File structure

```
interview-copilot/
├── index.js            # Electron main process
├── preload.js          # Secure IPC bridge
├── ai_client.js        # OpenAI client (default config)
├── classifier.js       # Question type detection + system prompts
├── index.html          # Main window UI
├── overlay.html        # Transparent overlay UI
├── config.js           # ⚠ YOUR CREDENTIALS — never commit (gitignored)
└── candidate_profile.js # ⚠ YOUR CV DATA — never commit (gitignored)
```

---

## Security notes

- `config.js` and `candidate_profile.js` are in `.gitignore` — never add them to version control
- API keys saved via the Settings panel are encrypted using Windows DPAPI / macOS Keychain (`safeStorage`)
- The overlay uses `setContentProtection(true)` which prevents it from appearing in screen recordings

---

## Tech stack

- [Electron](https://www.electronjs.org/) — desktop shell
- [OpenAI SDK](https://github.com/openai/openai-node) — streaming API client
- [marked.js](https://marked.js.org/) — markdown rendering
- [highlight.js](https://highlightjs.org/) — syntax highlighting
