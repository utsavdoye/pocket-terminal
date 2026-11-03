<p align="center">
  <img src="docs/app/icon.svg" alt="" width="88" height="88">
</p>
<h1 align="center">Pocket Terminal</h1>
<p align="center"><b>Your computer's terminal on your phone. From anywhere, even with the lid closed.</b><br>
Answer Claude Code with one tap, get pinged when a build finishes, open <code>localhost:3000</code> on your phone.<br>
Direct and end-to-end encrypted. No server, no account.</p>

<p align="center">
  <a href="https://github.com/utsavdoye/pocket-terminal/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/utsavdoye/pocket-terminal?style=flat-square&color=F5B843&labelColor=171B2D"></a>
  <a href="https://www.npmjs.com/package/pocket-terminal"><img alt="npm version" src="https://img.shields.io/npm/v/pocket-terminal?style=flat-square&color=F5B843&labelColor=171B2D"></a>
  <a href="https://www.npmjs.com/package/pocket-terminal"><img alt="npm downloads" src="https://img.shields.io/npm/dm/pocket-terminal?style=flat-square&color=F5B843&labelColor=171B2D"></a>
  <a href="https://github.com/utsavdoye/pocket-terminal/actions/workflows/test.yml"><img alt="Tests" src="https://img.shields.io/github/actions/workflow/status/utsavdoye/pocket-terminal/test.yml?branch=main&style=flat-square&label=tests&labelColor=171B2D"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-F5B843?style=flat-square&labelColor=171B2D"></a>
  <img alt="macOS, Windows, Linux" src="https://img.shields.io/badge/runs%20on-macOS%20%7C%20Windows%20%7C%20Linux-3DD68C?style=flat-square&labelColor=171B2D">
</p>

<p align="center">
  <img src="docs/media/demo.gif" alt="Demo: an AI agent asks 'Do you want to make this edit?', one tap on the phone answers it, then the computer's localhost:3000 opens on the phone" width="300">
</p>

```bash
npx pocket-terminal
```

<p align="center">
  <b><a href="https://pocket-terminal.utsavdoye.com">Website</a></b> ·
  <b><a href="https://pocket-terminal.utsavdoye.com/app/#demo">▶ Live demo</a></b> ·
  <a href="#-quick-start">Quick start</a> ·
  <a href="#-how-it-works">How it works</a> ·
  <a href="#-security">Security</a> ·
  <a href="https://pocket-terminal.utsavdoye.com/help.html">Help</a> ·
  <a href="https://github.com/utsavdoye/pocket-terminal/discussions">Discussions</a>
</p>

---

You're out, your laptop is in your bag with the lid shut, and you need to run *one* command on it.
Restart a server, pull the latest code, check if a job finished. Or Claude Code has been working
for 20 minutes and is now waiting for you to say **yes**.

**Pocket Terminal** lets you do that from your phone. Your phone and your computer connect
**directly to each other**, everything is **end-to-end encrypted**, and there's **no server for
you to run or pay for**. When the computer is asleep, it wakes itself every minute or two to check
for your commands, then goes back to sleep.

No npm? One line for your system:

```bash
curl -fsSL https://pocket-terminal.utsavdoye.com/install.sh | bash      # macOS, Linux
irm https://pocket-terminal.utsavdoye.com/install.ps1 | iex             # Windows (PowerShell)
```

<p align="center">
  <img src="docs/readme/screens.png" alt="Pair with a QR code and PIN, a live terminal, sending a command while the computer sleeps, replies, power settings" width="100%">
</p>

## ✨ What you get

| | |
|---|---|
| 🤖 **Run AI agents from your phone** | Start Claude Code, Codex or Aider, put the phone away. When it asks *"Do you want to proceed?"* your phone buzzes; answer with one tap. It keeps working with the lid closed. |
| 🔔 **"It's done" on your phone** | A long build, a download, a model training: you get a notification when it finishes or needs you. Sent straight from your computer, end-to-end encrypted. |
| 🌐 **Your localhost on your phone** | `npm run dev` on the laptop, open `localhost:3000` on the phone, from anywhere. |
| 📁 **Files both ways** | Grab a file (or a database backup) from the computer, or upload a photo into a project folder. |
| 👀 **Share a live view** | Send a view-only link: a friend or teammate watches your terminal live, and can't type a thing. The link expires. |
| 🎙️ **Say it** | Tap the mic in Ask: "free up port 3000" becomes the right command. |
| 🖥️ **A real terminal** | zsh, bash or PowerShell with colours, tab completion, and Ctrl/Esc/arrow keys on a touch keyboard bar. Several terminals at once. |
| 🌍 **Any network** | Phone on mobile data, computer on any Wi-Fi. No router settings, no port forwarding. |
| 🌙 **Works with the lid closed** | On charger it answers instantly. On battery it sleeps and checks in every 1–2 minutes. |
| 🔐 **End-to-end encrypted** | A key only your devices have. Nothing in the middle can read a single character. |
| ✦ **Ask in plain English** | "My app says port 3000 is in use" → the right command for your Mac or Windows PC, explained, ready to run. |
| 🔎 **Half-remember a command?** | Type `git sta` or "big files" and pick from 70+ built-in commands, your saved ones and your history. Works offline. |
| ⚡ **One-tap commands** | Your saved commands sit behind the ⚡ key on the key bar. |
| 📬 **Send now, runs later** | Computer asleep? Send the command anyway; the reply comes back to your phone. |
| 🔋 **Battery-safe** | It never stays awake below 20% battery and stops waking below 10%. |
| 🛡️ **Only phones you approve** | Each QR code works once. The computer shows a 6-digit code and you type `y`. Remove any phone later. |
| 📱 **Feels like an app** | PIN lock, light and dark themes, home-screen install, works on iPhone and Android. |
| 💻 **Mac, Windows and Linux** | One line to install or update on each. |

<p align="center">
  <img src="docs/screenshots/agent.png" alt="Claude Code asks 'Do you want to make this edit?' and the phone shows one-tap answers" width="24%">
  <img src="docs/screenshots/terminals.png" alt="Terminals: what's running on the computer, and a view-only share link" width="24%">
  <img src="docs/screenshots/localhost.png" alt="The computer's localhost:3000 open on the phone" width="24%">
  <img src="docs/screenshots/files.png" alt="Files: download from the computer, upload from the phone" width="24%">
</p>

## 🧭 How it works

<p align="center">
  <img src="docs/readme/how-it-works.svg" alt="Phone and computer meet through an encrypted note on a free message board, then talk directly" width="100%">
</p>

1. **Pairing (once per phone).** Your computer shows a one-time QR code. Your phone scans it and both
   screens show the same 6-digit code; you type `y` on the computer. The computer then gives that phone
   its own secret key, sent wrapped with a fresh key exchange (ECDH), so even someone who photographed
   the QR code can't read it. The QR code is then dead.
2. **Finding each other.** Both use a free public message board ([ntfy.sh](https://ntfy.sh)) as a
   private mailbox. The mailbox name and every note in it are scrambled with your key.
3. **Direct link.** The phone leaves a note saying "here's how to reach me", the computer answers,
   and both knock on each other at the same moment. Routers let that through. It's the same trick
   video calls use. From then on your terminal flows **straight between your devices**.

If a strict network blocks direct links, commands still travel as encrypted notes through the board.
That's a few seconds slower, but it works anywhere normal web browsing works.

## 🌙 Lid closed, battery safe

<p align="center">
  <img src="docs/readme/night-on-battery.svg" alt="Timeline of a night on battery: quick check-ins every 1 to 2 minutes, a command sent at 3:10 runs at the next check-in" width="100%">
</p>

A small "power brain" on your computer decides when to stay awake:

| Your computer is… | Your command runs |
|---|---|
| Plugged in, lid closed | **Instantly** |
| On battery, you used it in the last 30 min | Within **~1 minute** |
| On battery, idle for hours | Within **~2 minutes** (set 1 min if you like) |
| On battery with *Instant* mode on | **Instantly** (uses more battery) |
| Below 10% battery | Waits until you charge |

Each check-in keeps the computer awake for about 6 seconds, so frequent check-ins stay cheap.
You can change all of this from the phone: **⋯ → Power and battery**.

## ✦ Forgot the command? Just ask

<img src="docs/screenshots/ask.png" alt="Ask screen: a plain-English request turned into two commands, each explained and labelled careful or safe" width="300" align="right">

Tap **✦** and type what you want, either in plain English or the bit of the command you remember.

- **Built-in finder (free, offline).** 70+ everyday commands for macOS, Windows and Linux, plus your
  saved commands and the ones you ran before. Type `docker`, `git sta` or "free up port 3000" and the
  matches appear as you type, with obvious blanks already filled in (`3000`, `~/Downloads`).
- **AI helper (optional), any model you like.** Anything the finder doesn't know goes to an AI with
  **your own key**: ChatGPT models (OpenAI), Claude (Anthropic), Gemini, Groq, Mistral, DeepSeek, Grok,
  [OpenRouter](https://openrouter.ai/keys) (one key for all of them), or **any OpenAI-compatible API** via
  *Custom*. [Groq](https://console.groq.com/keys) and [Gemini](https://aistudio.google.com/apikey) keys are free.
  It knows whether your computer runs zsh or PowerShell. A **Test** button checks your key.
- **✦ Fix with AI.** When a command fails, tap *Fix with AI* in **⋯ → Send a command**. It sends that command and
  the end of its output, and you get back what went wrong and the command to run instead.
- **Nothing runs by itself.** You see each command, a one-line explanation and a
  <code>safe</code> / <code>careful</code> / <code>danger</code> label. The app checks every command itself
  as well, so it doesn't just trust the AI. Danger needs a second tap. You can edit any command
  before you run it.
- **Private.** The key is stored encrypted on your phone. Only the sentence you type goes to the AI,
  straight from your phone. Your files, command output and computer never do.

Set it up in **⋯ → Settings → AI helper**.

<br clear="right">

## 🚀 Quick start

You need a **Mac, a Windows 10/11 PC or a Linux computer** with [Node.js 18.20+](https://nodejs.org), and a phone.
It takes about 5 minutes. Want to look first? **[Try the demo](https://pocket-terminal.utsavdoye.com/app/#demo)**, nothing to install.

### 1. The phone app
The app lives at **[pocket-terminal.utsavdoye.com/app](https://pocket-terminal.utsavdoye.com/app/)**. Nothing to do here:
the installer uses it automatically.

> **Want your own copy instead?** The app's code is what handles your key, so the most careful setup is
> your own: click **Fork**, then in your fork go to **Settings → Pages → Deploy from a branch**, branch
> `main`, folder `/docs`. The installer notices the fork and uses `https://<you>.github.io/pocket-terminal/app/`.
> See [SECURITY.md](SECURITY.md).

### 2. Install on your computer

One line. Run it again any time to update; your pairing stays.

```bash
npx pocket-terminal
```

Works the same on macOS, Linux and Windows. No npm? Use the line for your system:

<table>
<tr><th>macOS and Linux (Terminal)</th><th>Windows (PowerShell, no admin needed)</th></tr>
<tr><td>

```bash
curl -fsSL https://pocket-terminal.utsavdoye.com/install.sh | bash
```

</td><td>

```powershell
irm https://pocket-terminal.utsavdoye.com/install.ps1 | iex
```

</td></tr>
<tr><td>Mac: asks for your password once (to manage sleep).<br>Linux laptops: once, for wake-up alarms. Linux needs build tools; the installer tells you the exact line.</td><td>Starts at every sign-in, hidden.</td></tr>
</table>

<details><summary>Prefer to read the code first, or install from your own fork?</summary>

```bash
git clone https://github.com/<you>/pocket-terminal.git
cd pocket-terminal/agent
bash install.sh                                          # macOS, Linux
powershell -ExecutionPolicy Bypass -File install.ps1     # Windows
```
The one-liners only download this repository from GitHub into `~/.pocket-terminal/app` and run the same installer.
</details>

Both end by showing a **one-time QR code**.

### 3. Pair your phone
1. Open the app link on your phone and install it: **Share → Add to Home Screen** (iPhone) or **⋮ → Install app** (Android).
2. Open **Pocket Terminal** from your home screen and tap **Scan QR code**. Or tap **Paste pairing link** and paste the link `pair.js` prints.
3. Your phone and computer show the same 6-digit code. If they match, type **y** on the computer.
4. Choose a PIN on the phone.

> **iPhone:** install first, then pair *inside* the home-screen app. iPhone keeps home-screen apps separate
> from Safari, so a pairing made in Safari doesn't carry over. The app reminds you if you open the link in Safari.

That's it. Open the app and you'll see your computer **awake, connected directly**.

## 🧰 Everyday use

| I want to… | Do this |
|---|---|
| Run something quickly | Tap ⚡ on the key bar and pick a saved command, or type in the terminal |
| Find a command I half-remember | Tap **✦**, type what you remember |
| Turn English into a command | Tap **✦**, type it, tap **Ask AI** (needs a key in Settings) |
| Save a command | ⚡ → **+ Save a command**, or **Save** on any Ask suggestion |
| Run something while it sleeps | Type it in the "asleep" card; the reply lands in **⋯ → Send a command** |
| Answer an AI agent or a `[y/N]` question | The **Needs you** bar appears above the keys: tap **1 · Yes**, **No**, **Enter**… |
| Get a ping when something finishes or asks | **⋯ → Settings → Phone notifications → Turn on** (iPhone: from the Home Screen app, iOS 16.4+). Backup: the free [ntfy app](https://ntfy.sh) |
| See what's running, switch terminals | **⋯ → Terminals**. Programs keep running when you close the app |
| Open my dev server | **⋯ → Local websites**, tap the port (or type it) |
| Download or upload a file | **⋯ → Files**: tap a file to download, **Upload here** to send one |
| Let someone watch | **⋯ → Terminals → Share live view**, pick how long, send the link. **Stop sharing** ends it at once |
| Pair another phone | `npx pocket-terminal pair` (or `node pair.js` in the `agent` folder): a fresh one-time QR code |
| See which phones can connect | `npx pocket-terminal list` |
| Lock one phone out | `npx pocket-terminal remove 2` (a number from the list, a name, or `all`). Works within seconds |
| See what it's doing | `npx pocket-terminal logs` |
| Update | `npx pocket-terminal@latest`, or run your install line again |
| Uninstall | `npx pocket-terminal uninstall` (add `--purge` to delete the pairing key too) |

## 🔐 Security

- **End-to-end encrypted:** AES-256-GCM for notes, DTLS for the direct link. The link's fingerprints
  are exchanged inside the authenticated notes, so nobody can sit in the middle.
- **Private by design:** the message board and STUN servers see only scrambled text and IP addresses.
  Command text is never written to logs. Notifications never contain your commands.
- **Only approved phones:** a QR code works once, for 10 minutes, and only after you type `y` on the
  computer next to a matching 6-digit code. If two phones try the same code, both are refused.
  Every phone has its own key, so you can remove one without touching the others.
- **Locked phone:** your key is stored encrypted with your PIN, and 10 wrong tries wipe it.
- **AI is opt-in:** off until you add your own key. It only sees what you type in Ask, and never runs
  anything without your tap.
- **Minimal rights:** on Mac it can run exactly four `pmset` sleep commands, on Linux two `rtcwake` commands; on Windows it needs no admin.
- **Notifications without a middleman:** your computer encrypts each one for your phone and signs it
  with its own key (standard Web Push). Apple or Google deliver a blob they can't read.
- **Share links are view-only, enforced on the computer:** a viewer's key can watch one terminal and
  nothing else (no typing, files, websites or commands), and it stops working when it expires or you stop it.

Read [SECURITY.md](SECURITY.md) for the full threat model, including what it **doesn't** protect against.

## ⚖️ Honest limits

- **The computer must be on and online.** Asleep is fine. Shut down or out of battery is not.
- **The message board is a free public service.** It only carries the encrypted hellos and backup
  commands, never your live terminal. It has a daily limit that's plenty for personal use. For heavy
  use, add your own board (see Advanced).
- **Some strict networks block direct links.** Then you get the slower backup route.
- **Windows support is newer (beta).** Windows can't report whether the lid is closed, so on battery
  it only sleeps after 10 minutes without keyboard or mouse use. Laptops with "Modern Standby" may
  ignore wake-up alarms on battery. The installer tells you; use Instant mode or keep it plugged in.
- **Local websites:** pages load through the app, so live-reload (WebSockets) and absolute links to
  other ports don't work yet. Only open sites you trust: they run inside the app.
- **Windows can't name the running program,** so "it finished" there means "busy for 30 s, then quiet for 15 s".
- **Quick check-ins need Wi-Fi to reconnect during a silent wake-up.** Most computers do this. If yours
  doesn't, use Instant mode on battery.

## ❓ FAQ

<details><summary><b>Is there really no server?</b></summary>

There's no server **you** run, and none that can read your data. Two devices on different networks
can't find each other without *some* public meeting point, so a free message board passes a few
encrypted "hello" notes. Your live terminal never goes through it.
</details>

<details><summary><b>How is this different from SSH, Tailscale or Claude Code's remote control?</b></summary>

Those assume your computer is awake. Pocket Terminal is built around a computer that's **asleep in your
bag**: it wakes itself briefly to check for work, runs it, replies, and sleeps again. And there's
nothing to configure on your router or account to sign up for.
</details>

<details><summary><b>What does it cost in battery?</b></summary>

Each check-in is about 6 seconds awake. With the defaults, my rough estimate is a few percent overnight.
Your real numbers are in the log.
</details>

<details><summary><b>Can someone else control my computer?</b></summary>

Only a phone you approved on the computer itself. A QR code works once, so a photo of it is useless
afterwards, and a second phone trying the same code cancels the pairing. Lost a phone? Run
`node pair.js --remove "<its name>"` and it is locked out within seconds.
</details>

<details><summary><b>Does it work on Linux?</b></summary>

Yes. Laptops get the same power brain (stays awake for you with `systemd-inhibit`, wakes to check in
with `rtcwake`). Desktops and servers simply stay awake. It runs as a systemd user service.
</details>

<details><summary><b>Can it really run Claude Code while my laptop is closed in my bag?</b></summary>

Yes. While a program in your terminal is still printing, the computer stays awake (on battery too,
above 20%, for up to 2 hours after you last used it). When the agent stops to ask you something, your
phone buzzes with the question. Tap the notification and answer.
</details>

## 🛠️ Advanced

- **Your own message board:** run [ntfy](https://docs.ntfy.sh/install/) anywhere, then
  `node pair.js --board https://ntfy.example.com` and re-pair. List several boards; if one is down,
  the others still work.
- **TURN server** for networks that block all direct links: add it to
  `~/.pocket-terminal/direct.json` → `"iceServers": ["stun:stun.l.google.com:19302", "turn:user:pass@host:3478"]`.
- **Different shell on Windows:** set `POCKET_SHELL` to `pwsh.exe` or `cmd.exe`.
- **Relay mode** (an always-on server in the middle): see [`relay/`](relay/).

## 🗂️ Project layout

```
cli.js            npx pocket-terminal: copies the agent to ~/.pocket-terminal/app, runs its installer
agent/            runs on your computer
  agent.js          starts everything
  direct.js         direct link + encrypted mailbox (WebRTC via node-datachannel)
  power.js          the power brain: when to stay awake, when to sleep
  platform/         sleep/wake switches for macOS, Windows and Linux
  lib/              encryption, message board, terminals + watcher (core.js), files, local
                    website proxy (preview.js), phone notifications (webpush.js)
  pair.js           one-time pairing QR + approve / list / remove phones
  devices.js        one private mailbox per paired phone
  install.sh / install-linux.sh / install.ps1
docs/             the phone app: static files served by GitHub Pages
  js/tools.js       terminals, Needs you, notifications, files, local websites, voice, sharing
  js/helper.js      Ask: built-in command finder, safety check, AI providers
  install.sh / install.ps1   the one-line installers
test/             offline tests: fake board, fake sleeping computer, real WebRTC in a browser
relay/            optional self-hosted relay
```

## 🧪 Tests

```bash
cd agent && npm test        # power brain, Windows + Linux parsers, Web Push encryption, message boards
python3 test/e2e_direct.py  # full run: phone app in a headless browser ⇄ agent, with a sleeping computer
python3 test/e2e_ask.py     # Ask: finder, AI (fake provider), danger checks, key encryption, Fix with AI
python3 test/e2e_pairing.py # one-time QR, approval code, reused QR, two phones racing, removing a phone
python3 test/e2e_scan.py    # iPhone home-screen app: scan the QR with the camera, or paste the link
python3 test/e2e_autoconnect.py # the Mac falls asleep on its own; the app reconnects by itself when it wakes
python3 test/e2e_mobile.py  # touch: Tab/^X keys, paste, swipe scrolls only the terminal, continue vs fresh terminal
python3 test/e2e_demo.py    # demo mode: no pairing, pretend shell, sleep/wake, themes, stores nothing
python3 test/e2e_tools.py   # Needs you, terminals, notifications, files, local websites, view-only sharing
```

The end-to-end test pairs a phone, opens the direct link, runs commands, puts the computer to sleep,
sends a command, wakes it, checks the reply, tests the backup route, and confirms the board never saw
any readable text.

## 📄 License

[MIT](LICENSE). Built by [Utsav Doye](https://github.com/utsavdoye).
If this saved you a trip back to your laptop, a ⭐ helps others find it.
