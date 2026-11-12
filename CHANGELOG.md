# Changelog

## Next release
- **"Your computer is awake" could be skipped.** If you opened the app less than 5 seconds before the sleeping computer's next check-in and then left, it never told you it was up. It now goes by whether you knocked while it slept.
- **Safari (iPhone):** saving the last screen as the app closed could fail with an error. Packing and unpacking now happen straight from memory.
- Tests on GitHub: the test browser download is tried 3 times, and one test no longer trips over a list that redraws itself.

## 7.5.1 (2026-11-12)
- A phone browser without direct links (WebRTC turned off, some locked-down phones) now goes straight to the board instead of getting stuck on "Connecting".
- New test run on GitHub's Mac and Windows computers, with the phone as an iPhone (Safari's engine) and as an Android phone: pair, connect, and the same with direct links blocked.

## 7.5.0 (2026-11-11)
**Connects on any network, for free.**

- **Works on mobile data and strict Wi-Fi.** Many networks (Indian mobile data, offices, colleges) block a direct link between phone and computer, and the app fell back to the slow "Backup route" with no live terminal. Now, when the direct link doesn't open within a couple of seconds, the app carries on through Pocket Terminal's own board: the live terminal, files, local websites, everything. Every message is sealed with your pairing key, so the board can't read it. No relay service, no card, nothing to sign up for. On most home Wi-Fi it still goes direct.
- **Faster to connect everywhere.** The phone and the computer used to wait up to 4 s each to collect their network addresses before answering. They now go as soon as the addresses that matter are known.
- On Node 18 and 20 the computer now uses its own small WebSocket client (Node's own certificate checks).
- Settings → About says whether the link is direct or through the relay, and Copy info includes it.
- (Optional, for people who run their own board: it can also hand out logins for a TURN relay, Metered or Cloudflare. See board/README.md. Not needed.)

## 7.4.2 (2026-11-11)
- **Your computer now uses Pocket Terminal's own message board too.** 7.4.1 turned it on in the phone app only; with this update the computer reads and posts there as well (ntfy.sh stays as the backup). This ends "The free message board is full for today", and pairing codes that never appeared on shared Wi-Fi. Update with `npx pocket-terminal@latest`.

## 7.4.1 (2026-11-11)
**Smoother on a phone: typing that doesn't wait, faster drawing, and something on screen the moment you open it.**

### New
- **Pocket Terminal's own message board** (the `board/` folder, on Cloudflare Workers). The free ntfy.sh allows only a few hundred messages a day per internet connection, shared by everyone on the same college, office or mobile network, so the app could say "board full" or fail to pair. The app and the agent now use our own board first (its limit is per mailbox, not per network) and keep ntfy.sh as the backup. Existing pairings pick it up after updating; nobody pairs again.
- A board that is down is tried again after 3 s, then 6, 12… up to a minute, not every 3 s forever.
- **Typing ahead on a slow link.** On weak mobile data each letter used to wait for the computer to send it back. Letters now show at once (dimmed) and are checked when the computer answers. It only turns on when the link is slow, it never shows a password (nothing is drawn until the computer has echoed a letter), and Settings → Typing ahead turns it off.
- **Smoother drawing.** The terminal is drawn with the phone's graphics chip, so long agent output and scrolling stay smooth. If a phone can't do it, it quietly uses the old drawing. Settings → Smooth drawing turns it off.
- **Something to look at right away.** Opening the app shows the screen from last time (dimmed, marked "From last time") while it connects, then swaps in the live one. It is kept on your phone only, encrypted with the pairing key.
- **`npx pocket-terminal doctor`** checks the setup (version, agent running, phones paired, message board, direct link, notifications, wake-up alarms, recent problems in the log) and prints a report to paste into a bug report. No keys, phone names or folder names are in it.
- **"Finished" notifications show the last lines** the program printed (never the prompt, and never a line that looks like a password, key or token).
- **Swipe a sheet down** by its top bar to close it.
- **Saved commands can be changed** (✎), and new phones start with Git status, Git pull, Run tests and Disk space.
- When connecting takes longer than usual, the app says so and how long it can take; after a drop it says "Reconnecting…".

## 7.4.0 (2026-11-09)
**Several computers, a laptop that wakes when the app says, and a cleaner app.**

### New
- **Several computers on one phone.** Pair your laptop, a desktop and a server. Tap the computer's name at the top to switch, or to pair another one (scan its QR code right there). Each keeps its own PIN, terminals and command history. Before, pairing a second computer replaced the first.
- **Wakes up when the app says.** The app shows exactly when a sleeping laptop wakes ("wakes up in 14s"), and it connects then. Leave the app and you get one "is awake ✓" notification when it's ready.
- **Smart wake-ups (new default).** With the lid closed on battery it checks for your phone every 20 s for 30 min after you use it, every minute in the hours you usually use it, and every 3 min at night. It learns your usual hours. Or pick Fast, 1 min, 3 min or Always on in Power settings. On the charger it never sleeps, as before.
- **Swipe left or right** on the terminal to switch terminals.
- **`npx pocket-terminal activity`** shows what your phones did on this computer (connected, files, answers, live-view links). Never what you typed.
- **Settings in groups**, plus Bigger keys, Vibration on/off, Copy info for bug reports, and a short first-run tour.
- **Update bar:** when your computer runs an older version than the app, one tap copies the update command.

### Fixed
- The app could say "asleep" while the computer was open.
- Android keyboards "corrected" commands (`ls` became `Is`). Autocorrect and word suggestions are now off in the terminal.
- The phone could use up the free message board's daily limit and then not connect at all. It now sends far fewer messages (waiting 75 s costs 2 instead of about 8), and if the board is ever full the app says so and what to do, instead of "This phone is offline".
- Opening the app could skip its knock, so a sleeping laptop noticed the phone only on a later try.
- A long diff or a folder with thousands of files never loaded.
- Error screens now have buttons that fix the problem (Try again, Reconnect, copy the start command), and `claude on` / `run` say how to update when the computer's copy is too old.

### For contributors
- The phone app and the agent are split into small files by job, every message is documented in [PROTOCOL.md](PROTOCOL.md), test failures show as annotations on GitHub, `node scripts/release.js` does a release, and `python3 scripts/media.py` rebuilds every screenshot.

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
