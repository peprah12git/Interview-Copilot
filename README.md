# Interview Copilot

A Windows desktop app that gives you real-time, AI-generated answers while you practise interviews. Type a question or capture your screen, and the answer streams into a floating overlay, tailored to your own CV.

---

## Features

- **AI-powered answers**: responses stream word by word with markdown rendering and syntax-highlighted code.
- **Invisible overlay**: a transparent, always-on-top panel that uses Windows content protection so it is hidden from screen-sharing and recording tools.
- **Manual input and screen capture**: type a question into the main panel, or capture your screen and let the AI read the question from it. (Microphone input is not supported in v1.0.0.)
- **Question classifier**: detects coding, behavioural, ML/AI, Quality Assurance and general questions and switches to a matching answer style. QA covers test case design, AI output validation, data annotation, model evaluation, test documentation and cross-team communication.
- **CV personalisation**: enter your name, roles, education, projects, skills and certifications in **Settings > CV Profile**. Answers are written as you, using only what you provide. The profile is encrypted with Windows DPAPI and stored only on your machine.
- **Interview Mode**: hide the control panel with one click or hotkey.
- **Settings panel**: change the API key, base URL and model at runtime. The key is encrypted with OS-level storage.

---

## Requirements

- **Windows 10 or later (64-bit)**
- **An API key** for an OpenAI-compatible chat completions endpoint (for example an AI gateway serving Claude or GPT models), plus its base URL
- An internet connection

---

## How to install

1. Go to the [Releases page](https://github.com/peprah12git/interview-copilot/releases/latest).
2. Under **Assets**, download `Interview Copilot Setup 1.0.0.exe`.
3. Run the installer and follow the prompts. You can choose the install folder.
4. Windows SmartScreen may warn that the app is from an unknown publisher, because the installer is not code-signed. Choose **More info > Run anyway** if you trust the source.
5. Launch **Interview Copilot** from the Start menu or desktop shortcut.

On first launch:

1. Click **Settings**.
2. On the **API & Model** tab, enter your API key, base URL and model, then click **Save & Apply**.
3. On the **CV Profile** tab, fill in your details and click **Save Profile**.

---

## How to use

1. Launch the app. The main control panel opens.
2. Press `Ctrl+Shift+H` to show the overlay and position it where you want.
3. Click **Interview Mode** or press `Ctrl+Shift+M` to hide the control panel.
4. Type a question into the main panel and press `Enter`, or press `Ctrl+Shift+S` to capture the screen and get an answer.
5. The answer streams into the overlay. Scroll with the mouse wheel or arrow keys.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+H` | Show / hide the overlay |
| `Ctrl+Shift+S` | Capture the screen and get an answer |
| `Ctrl+Shift+M` | Hide / restore the main window |

---

## Disclaimer

Interview Copilot is intended for **practice and conversational interviews only**. Do not use it in any interview, assessment or exam where external assistance is prohibited. You are responsible for following the rules of any employer, platform or institution you interact with. The authors accept no liability for misuse. AI answers can be wrong, so always check them.

---

## Privacy and security

- Your API key and CV profile are encrypted with Electron `safeStorage` (Windows DPAPI) and stored in your user data folder, `%APPDATA%\interview-copilot`.
- If OS encryption is unavailable, the CV profile is not saved, rather than being stored as plain text.
- Your profile and questions are sent only to the AI endpoint you configure.

---

## Development

```bash
git clone https://github.com/peprah12git/interview-copilot.git
cd interview-copilot
npm install
```

Create `config.js` in the project root. It is gitignored, so never commit it:

```js
module.exports = {
  baseURL: 'https://your-gateway.example.com/v1',
  apiKey:  'sk-your-api-key-here',
};
```

Create `candidate_profile.js` exporting a default profile string. It is also gitignored. It is used only until you save a CV Profile in Settings.

```js
module.exports = `
CANDIDATE PROFILE:
Name: Your Name
`;
```

```bash
npm start          # run the app
npm test           # run the profile service tests
npm run build:win  # build the Windows installer into dist/
```

## Tech stack

[Electron](https://www.electronjs.org/), the [OpenAI SDK](https://github.com/openai/openai-node), [marked](https://marked.js.org/) and [highlight.js](https://highlightjs.org/).
