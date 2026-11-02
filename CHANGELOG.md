# Changelog

## 7.0.1 (2026-11-02)
- First release published to npm automatically from GitHub (trusted publishing, with provenance).
- New home: **terminal.utsavdoye.com** (a website with install steps for every system); the phone app moved to **terminal.utsavdoye.com/app**. Pair your phone again once.
- GitHub moved to github.com/utsavdoye/pocket-terminal.

## 7.0 (2026-11-02)
- **AI agents from your phone:** when a program stops to ask (Claude Code's "Do you want to proceed?",
  `[y/N]`, "Press Enter"), a **Needs you** bar appears with one-tap answers, and your phone gets a notification.
  A program that's still working keeps the computer awake on battery (above the battery floor, up to 2 h).
- **Phone notifications** straight from your computer (Web Push, end-to-end encrypted, no server):
  when a program finishes or needs you. Tap one to open that terminal.
- **Terminals:** several at once; anything still running survives closing the app; switch or close from the menu.
- **Local websites:** open your computer's `localhost:3000` on the phone, through the encrypted link.
  Running dev servers are detected.
- **Files:** browse, download to the phone, upload from it (up to 250 MB).
- **Share a live view:** an expiring, view-only link to one terminal.
- **Voice** in Ask.
- **On npm:** `npx pocket-terminal` installs or updates on any system; `pair`, `list`, `remove`, `logs`, `uninstall` too.
- **One-line install and update** for macOS, Linux and Windows. **Linux laptops** get the power brain
  (systemd-inhibit + rtcwake) and a systemd user service. Windows reads battery from one long-lived
  PowerShell instead of starting a new one every 20 s.
- Demo mode shows all of it, including a pretend AI agent (type `claude`).

## 6.2 (2026-10-28)
- Light theme by default, with Settings → Appearance (Light / Dark / Auto) and a matching terminal.
- Demo mode: tap **See a demo first** (or open `#demo`) to try the whole app with a pretend
  computer. It never connects anywhere or touches your pairing.
- Motion: the lamp line ignites when the link goes live, pages slide, the menu springs open,
  lists settle in. All of it switches off with Reduce Motion.

## 6.0–6.1
- Redesigned phone app: one clean terminal screen, a single key bar that sits on the keyboard,
  and a simple menu.
- Security: pairing links can't silently replace an existing pairing; PIN lock uses 600,000
  PBKDF2 rounds (old locks upgrade themselves); installs use `npm ci` with exact versions.
- CI runs unit and end-to-end tests on every push; CodeQL and Dependabot watch the repo.

## 5.4 (2026-10-25)
- Paste works after switching apps; typing during a reconnect is kept and sent.
- Coming back to the app continues the same terminal; reopening a closed app starts a fresh one.
- Swiping scrolls only the terminal; key bar taps no longer lose keyboard focus; ^X and ^O keys.

## 5.3 (2026-10-25)
- Settings shows the app version and has a Reload button.
- A removed phone is told so and forgets its key. `pair.js --list` shows numbers and times.

## 5.2 (2026-10-25)
- The computer always keeps a wake-up alarm set ahead when sleep is allowed, so it checks in even
  when macOS sleeps on its own. The phone keeps retrying and reconnects by itself.
- Low battery: still checks in (every 10 minutes) instead of skipping the mailbox.

## 5.1 (2026-10-25)
- Pair from inside the iPhone home-screen app: Scan QR code (camera) or Paste pairing link.

## 5.0 (2026-10-25)
- One-time QR pairing approved on the computer with a 6-digit code; a separate key per phone;
  list and remove phones.
- Ask: any AI provider (OpenAI, Claude, Gemini, Groq, OpenRouter, Mistral, DeepSeek, xAI or any
  OpenAI-compatible API), Test button, and Fix with AI for failed commands.

## 4.x (2026-10-24)
- Direct peer-to-peer mode, the power brain for lid-closed use on battery, Windows support (beta),
  built-in command finder, and the night-themed phone app.
