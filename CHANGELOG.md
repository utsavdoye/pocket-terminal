# Changelog

## Next release
- **Wakes up when the app says, and faster.** The app now shows exactly when a sleeping laptop wakes ("wakes up in 14s") and it really connects then: the phone leaves its knock in the mailbox just before, so it connects the second it wakes. If a check-in is missed it says so ("taking longer than usual") instead of guessing.
- **Smart wake-ups (new default):** with the lid closed on battery it checks in every 20 s for 30 min after you use it, every minute for the next 2 hours and in the hours you usually use it, and every 3 min at night. It learns your usual hours. Or pick Fast (20 s), 1 min, 3 min or Always on in Power settings. On the charger it never sleeps, as before.
- **Leave the app while it wakes:** you get one "is awake ✓" notification when it's ready.
- **Fixed: opening the app could skip its knock** when the mailbox still held an old "online" note, so a sleeping laptop didn't notice the phone until a later try.
- **Check-ins are quiet:** a wake-up with the lid closed no longer posts to the mailbox each time, and notices the wake within a second.
- **Several computers on one phone.** Pair your laptop, a desktop and a server: tap the computer's name at the top to switch, or to pair another one (scan its QR code right there). Each keeps its own PIN, terminals and command history. Notifications come from the one you used last. Before, pairing a second computer replaced the first.
- **Swipe between terminals:** swipe left or right on the terminal for the next or previous one.
- **"Your computer runs an older version" bar:** when the computer is behind the app, one tap copies the update command.
- **Fix buttons when something's wrong:** offline → Try again; computer not answering → Reconnect, or copy the start command.
- **Settings in groups** (Notifications, AI agents, Look and feel, Security, About), plus **Bigger keys**, **Vibration on/off**, and **Copy info** for bug reports (no keys, nothing you typed).
- **A short tour** the first time the app connects (Settings → Show the tour again).
- **`npx pocket-terminal activity`:** what your phones did on this computer (connected, files, answers, live-view links). Never what you typed or what commands printed.
- **Fixed: a long diff or a folder with thousands of files never loaded** (the message was too big and was dropped). Big messages are now packed or sent in parts.
- **Clearer errors:** `claude on` and `run` say how to update when the computer's copy is too old.
- **For contributors:** the phone app and the agent are split into small files by job, every message is documented in PROTOCOL.md, test failures show up as annotations on GitHub, and `node scripts/release.js` does a release in one command.
- **Fixed: Android keyboards "correcting" commands.** Pressing space no longer turns `ls` into `Is` or swaps in a predicted word: the terminal turns off autocorrect, word suggestions, auto-capitals and spell check.
- **Fixed: the app said "asleep" while the computer was open.** If the lid was opened again right after the computer started to sleep, the agent didn't notice it was awake and stayed deaf to the phone for minutes. Now it reconnects at once after any sleep, and tells the phone it's awake within a second or two of waking.

## 7.3.1 (2026-11-06)
- **No more double notifications:** Claude Code started with `npx pocket-terminal run claude` (or from the phone) was reported twice, once from the screen and once from its hook. The hook now stays out inside Pocket Terminal.
- **Clean screen when you switch to the phone:** opening a session that was started in a wide computer window used to show the wide screen squeezed and broken (Claude Code's boxes, vim, htop). The program now redraws at the phone's width first and the phone gets that clean screen. The same happens whenever you go back and forth between the computer and the phone.
- **"Your computer is awake" notification:** open the app while the computer sleeps, then go do something else: when it wakes and finds you gone, your phone buzzes once ("MacBook is awake ✓, tap to connect") and it stays awake 3 minutes for you. The app also knocks the moment it opens, so a quick look is enough.
- **A dock at the bottom:** Keyboard, Agents (with a badge when one needs you), Command and Files, one thumb away. It hides while you type.
- **Cleaner header:** connection speed and battery in one small capsule, with a battery that fills to its level; round icon buttons.
- **Keys light up** when you press them, and flash when they fire.
- **Dependabot pull requests are off.**

## 7.3.0 (2026-11-05)
- **Start on the computer, carry on from the phone:** `npx pocket-terminal run claude` (or any command) runs in your own terminal window as usual, and live on your phone. Close the window or walk away: it keeps running, its questions reach your phone, and you continue there. Whoever types sets the screen size.
- **Claude Code anywhere, even in VS Code:** `npx pocket-terminal claude on` adds Pocket Terminal to Claude Code's official hooks (your other settings are kept, with a backup). When you're away from the computer (no keyboard or mouse for a minute), its permission questions come to your phone (app and notification) with Allow / Deny, and the answer goes straight back to Claude. At the computer, or back at it, they show on screen as usual. While Claude works the computer stays awake (lid closed too), and your phone hears when it finishes. `npx pocket-terminal claude off` removes it.
- **A local door for the agent:** a socket in your private folder, usable only with a token only you can read.
- **Live strip:** over the key row, "Claude Code needs you" or "2 agents working", one tap to the dashboard.
- **Look and feel:** icon tiles in the menu, cards that animate in and respond to touch, a moving line on working agents.

## 7.2.0 (2026-11-05)
- **Works on a weak signal:** big output is sent compressed (terminal text shrinks 3-10x). If the link is slower than the output, the phone skips ahead to the current screen instead of falling minutes behind: on a 4 KB/s link, what you type shows up right after a 300 KB flood.
- **Reconnects by itself, faster:** switching Wi-Fi to mobile data, a dropped signal or a link that died quietly is noticed and rebuilt in seconds. If the phone's own internet fails, it retries in 3-20 s instead of waiting a minute.
- **Typing feels instant:** a keystroke's echo is sent the moment it appears (only bursts of output are gathered).
- **Holding delete works like in a message:** phone keyboards that send only "delete" events, and speed up to whole words, now clear text properly.
- **Key row:** ⇧tab (switch mode in Claude Code), ^A ^E ^W ^U, del and more symbols, grouped, with a fade showing there's more to scroll.
- **Files:** tap a file to put its path in the terminal, or download it.
- **Welcome screen:** one command for every computer (`npx pocket-terminal`) with a copy button, and the install guide one tap away.

## 7.1.0 (2026-11-04)
- **Agents dashboard** (⋯ → Agents & terminals): every terminal with its program, folder and state. Who needs you (and the question), what's working and for how long, what finished. Answer a waiting one without switching to it.
- **Answer buttons on notifications:** Yes / No right on the notification, even with the app closed and the phone locked (Android). Each question gets a one-time key inside the encrypted notification; answers are encrypted, work once and expire after 30 minutes. (iPhone web apps can't show notification buttons yet: tap the notification instead.)
- **Answer in your own words:** 🎤 Say on any question. On an AI agent's menu it chooses "No, tell it what to do instead" and sends your words.
- **Auto-approve safe steps** (Settings, off by default): answered "Yes" only when the agent's question box shows one of your safe words and none of the risky ones.
- **What changed:** "finished" notifications and the dashboard show files changed (+added −removed) for git folders; See changes shows the diff.
- **Team links:** a live-view link can be allowed to press Yes / No on questions, and nothing else (checked on the computer).
- Fixed: an answered question could be seen as asked again; a question asked right after a program ended could be missed.

## 7.0.2 (2026-11-03)
- New website design: dark theme, a live terminal demo, clearer install steps, help and privacy pages.
- Rewritten README, a sharper demo video and GIF, and a Buy Me a Coffee link for anyone who wants to support the project.
- Same app and agent as 7.0.1; update only if you want the latest files: `npx pocket-terminal@latest`.

## 7.0.1 (2026-11-02)
- First release published to npm automatically from GitHub (trusted publishing, with provenance).
- New home: **pocket-terminal.utsavdoye.com** (a website with install steps for every system); the phone app moved to **pocket-terminal.utsavdoye.com/app**. Pair your phone again once.
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
