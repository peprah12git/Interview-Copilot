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

## Set up from source (cloning on a new machine)

Use this if you cloned the repository instead of using the installer. Two files the app needs, `config.js` and `candidate_profile.js`, are **not in the repository** because they hold secrets and personal data. You must create them, or the app will not start.

### 1. Prerequisites

- Windows 10 or later (64-bit)
- [Node.js](https://nodejs.org/) 18 or later (this includes `npm`)
- [Git](https://git-scm.com/)

Check them with `node --version`, `npm --version` and `git --version`.

### 2. Clone and install

```powershell
git clone https://github.com/peprah12git/Interview-Copilot.git
cd Interview-Copilot
npm install
```

If the feature branch has not been merged into `main` yet, switch to it before installing:

```powershell
git checkout feature/cv-profile
```

### 3. Create `config.js`

In the project root, create `config.js` with your AI gateway details. It is gitignored, so it will never be committed.

```js
module.exports = {
  baseURL: 'https://your-gateway.example.com/v1',
  apiKey:  'sk-your-api-key-here',
};
```

The gateway must accept OpenAI-style `/v1/chat/completions` requests. You can also leave `apiKey` empty (`apiKey: ''`) and enter the key later in **Settings > API & Model**, where it is stored encrypted.

### 4. Create `candidate_profile.js`

This is the default profile used until you save your own CV in **Settings > CV Profile**. A minimal version is enough:

```js
module.exports = `
CANDIDATE PROFILE:
Name: Your Name
`;
```

### 5. Run it

```powershell
npm start
```

Then open **Settings** and fill in your **CV Profile**. If the API key banner appears at the top, open **Settings > API & Model** and add your key.

### 6. Check everything works

```powershell
npm test
```

Both test files should report no failures. They do not need an API key or network access.

### Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot find module './config'` | You have not created `config.js` (step 3). |
| `Cannot find module './candidate_profile'` | You have not created `candidate_profile.js` (step 4). |
| Banner says no API key is configured | Add the key in **Settings > API & Model**. |
| Answers fail with an authentication error | The key or base URL is wrong. Re-enter them in Settings. |
| "Encryption unavailable" when saving a profile | Windows could not provide secure storage for your user account. Sign in as a normal Windows user and try again. |
| Two copies of the app open | An earlier run is still alive. End the `electron.exe` processes in Task Manager and start again. |

Your saved API key and CV profile live in `%APPDATA%\interview-copilot` on that machine. They are encrypted for the Windows user who saved them, so they do not carry over to another machine or account. You will need to re-enter them there.

### Building the installer yourself

```powershell
npm run build:win
```

The installer is written to `dist\`. **Warning:** the build packages your local `config.js` and `candidate_profile.js` into the app, so an installer you build contains your API key and personal details. Do not share or publish it.

### Scripts

```powershell
npm start          # run the app
npm test           # run the profile service and classifier tests
npm run build:win  # build the Windows installer into dist/
```

## Tech stack

[Electron](https://www.electronjs.org/), the [OpenAI SDK](https://github.com/openai/openai-node), [marked](https://marked.js.org/) and [highlight.js](https://highlightjs.org/).
