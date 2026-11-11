# Pocket Terminal protocol

This page describes every message the phone app and the computer send each other.
It is written from the code. If the code and this page disagree, the code wins, and this page should be fixed.

- Phone side: `docs/app/js/app.js`, `tools.js`, `board.js`, `crypto.js`, `docs/app/sw.js`
- Computer side: `agent/direct.js`, `devices.js`, `pair.js`, `hook.js`, `run.js`, `agent/lib/*.js`
- The security model is in [SECURITY.md](SECURITY.md).
- The optional relay mode (`agent/relay-transport.js`, `relay/`) is older and is not covered here.

## 1. Overview

There are three channels between phone and computer, plus one door on the computer itself.

| Channel | What it is | Used for |
|---|---|---|
| **Mailbox** | Encrypted notes posted to a private topic on an ntfy board (`https://ntfy.sh` by default). | Pairing. Setting up the direct link (hello, offer, answer). Status ("online" / "sleeping"). The backup route for commands and settings when there is no direct link. |
| **Direct link** | A WebRTC data channel (label `pt`, ordered), encrypted with DTLS. | Everything live: the terminal, sessions, files, local websites, sharing, notification setup. |
| **Web Push** | Standard Web Push, encrypted for the phone and signed with the computer's VAPID key. | Notifications: "needs you", "finished", "awake". Yes/No buttons on a notification answer through the mailbox. |
| **Local socket** | `~/.pocket-terminal/ctl.sock` (a named pipe on Windows), token protected. | Programs on the computer talk to the running agent: `npx pocket-terminal run`, and the Claude Code hook. |

There is also a second ntfy topic, the **notify topic** (`ptn-…`). The computer posts plain, content-free pings there
("Command finished ✅") for people who use the ntfy app instead of Web Push. Nothing private goes there.

### A normal connection

1. The phone posts a `hello` note. This wakes the computer's attention: it stays awake about 2 minutes and posts `status: online`.
2. The phone makes a WebRTC offer, waits up to 4 s for its addresses (ICE), and posts an `offer` note with a fresh `oid`.
3. The computer answers the offer and posts an `answer` note with the same `oid`.
4. Both sides punch through NAT. The data channel opens.
5. The phone sends `attach` first (which session, its size, whether it can unpack compressed messages).
6. The computer replies `hi`, then `reset` (the whole screen), `size`, and `power`.
7. From then on: `i` (keys) goes one way, `o` (output) the other. `ping` / `pong` every 5 s.

If no answer comes in 15 s, the phone shows "waiting" and tries again later (45 s, 60 s, 90 s, 120 s).
If the link does not open within 20 s of the answer, the phone uses the backup route (commands as mailbox notes).

## 2. Mailbox notes

### Keys and format

Pairing gives each phone its own 32-byte secret. Both sides derive three things from it with HKDF-SHA256
(salt `pocket-terminal/v1`):

| Name | Info string | Result |
|---|---|---|
| `topic` | `topic` | `pt-` + base64url(18 bytes). The private mailbox. |
| `notifyTopic` | `notify` | `ptn-` + base64url(18 bytes). The content-free ping topic. |
| `key` | `key` | 32-byte AES-256-GCM key. |

One note on the wire:

```
"pt1." + base64url( iv[12] | ciphertext | tag[16] )
plaintext = deflate-raw( JSON )
AAD       = "pt1:" + topic
```

A note must be at most **3800 characters** (`MAX_NOTE`; ntfy turns bigger notes into attachments).
ntfy.sh keeps notes for 12 hours. Several boards can be listed: both sides post to all and read from all. The default list is Pocket Terminal's own board (`board/` in this repo, when `OWN_BOARD` is set) and then `https://ntfy.sh`. A pairing that lists only ntfy.sh is treated as "the default", so it gets our board too.

Reading live notes: ntfy.sh is read as a stream (`GET /{topic}/json?since=…`). Any other board is tried over a WebSocket first (`GET /{topic}/ws?since=…`: the same JSON, one per message; the client sends `ping` every 30 s and gets `pong`), and read as a stream if it has no WebSocket. Our own board only has the WebSocket and `?poll=1`.

**The pipe** (our own board only): when the direct link doesn't open within 2.5 s of the answer (or fails), the phone opens `wss://{board}/{topic}/pipe?id={pipe id}&side=phone` and posts a sealed `pipe` note `{pipe: id}`; the computer opens the same with `side=mac`. The board sends `{"pipe":"ready"}` to both when both are there, passes every other message to the other side, and sends `{"pipe":"closed"}` (then closes) when one side leaves. Each message is `seal({p: pipe id, s: 'phone'|'mac', n: 0,1,2…, d: the message as JSON text})`: a side drops anything not from the other side, for another pipe, or out of order. Over a pipe the phone asks for `z: 0` (no packed binary messages); everything else is the same as the direct link.

**Relay login** (our own board only): `GET /{topic}/ice` returns `{"iceServers":[{urls, username, credential}], "ttl": seconds}` — a short-lived login for Cloudflare's TURN relay, the same for everyone using that mailbox. Port 53 addresses are left out. An empty list means the board has no relay set up. The phone adds these to its STUN servers; the computer uses the `turn:…?transport=udp` addresses. Either side can still connect directly; the relay is used when a direct link is blocked.

Every note has the same envelope:

| Field | Meaning |
|---|---|
| `id` | Random id (9 bytes, base64url). Used to drop duplicates and replays. |
| `ts` | Sender's clock, in ms. |
| `from` | `phone` or `mac` (the computer always says `mac`, also on Windows and Linux). |
| `type` | What the note is (below). |

The computer drops a note if: it does not decrypt, `from` is not `phone`, its `id` was seen before
(the last 500 ids are saved to disk), or its `ts` is more than 2 minutes in the future.
The phone drops a note if it does not decrypt, `from` is not `mac`, or its `id` was seen before.

### Phone → computer

| `type` | Fields | Freshness limit | What it does |
|---|---|---|---|
| `hello` | none | 3 min | "The app is open." The computer stays awake ~2 min and posts `status: online`. If the note is older than 5 s (it waited while the computer slept), the computer may send a "ready" push 15 s later. |
| `offer` | `oid`, `sdp` | 90 s | A WebRTC offer. The computer answers it. Older than 5 s: also the "ready" push logic. |
| `cmd` | `cid`, `cmd` | 60 min (`maxCommandAgeMinutes`) | Run one command by itself (backup route). Each `cid` runs only once. Max 4000 characters. |
| `settings` | `power` (object) | 24 h | Change power settings. Allowed keys: `enabled`, `awakeOnCharger`, `batteryMode` (`saver` / `instant`), `checkInMinutes`/`smartCheckIn` (older phones; ignored now), `speed` (`smart` / `fast` / `balanced` / `saver`), `idleMinutes`, `minBattery` (5–90), `stopAlarmsBelow`. |

A **viewer** (share link) computer only reacts to `hello` and `offer`.

### Computer → phone

| `type` | Fields | What it does |
|---|---|---|
| `status` | `state` (`online` / `sleeping`), `name`, `os`, `nextWake`, `plan` (when sleeping: `[start, end, every seconds]` pieces, `end` null = from then on; wake-ups fall on the clock grid of `every`, see agent/lib/schedule.js), `checkIn`, `power` {`percent`, `onCharger`, `settings`} | Shows awake or asleep, and counts down to the next wake-up. Posted rarely: on start, on `hello`, after a wake the user caused (at 0.5 s, 4 s, 12 s; quiet check-ins post nothing), before sleep when the plan changed, or when it changes. Otherwise at most once an hour. The phone ignores a status older than the last one. If it is `online`, less than 3 min old, there is no open link, and no offer was sent in the last 80 s, the phone connects (without a new `hello`). |
| `answer` | `oid`, `sdp` | The WebRTC answer. The phone only takes it if `oid` matches its current attempt and it is still waiting for an answer. |
| `result` | `cid`, `code`, `out` | Output of a `cmd` sent through the mailbox. If the note is too big, the start of `out` is cut (`…(start cut)…`) until it fits. Also pings the notify topic. |
| `revoked` | none | This phone was removed on the computer. The phone forgets its key. |

### Pairing notes (on the one-time invite topic)

These use the same format, but the keys come from the one-time invite secret in the QR code, not from a phone's secret.

| Direction | `type` | Fields |
|---|---|---|
| phone → computer | `join` | `nonce`, `pub` (phone's P-256 public key, raw, base64url), `device` (a name like "iPhone (app)") |
| computer → phone | `welcome` | `for` (the nonce), `wrap` {`epub`, `iv`, `ct`} |
| computer → phone | `denied` | `for`, `why` |

`wrap` is AES-256-GCM. Key: HKDF-SHA256(ECDH(computer's one-off key, phone key), salt `pocket-terminal/pair-v1`, info `wrap`).
AAD: `join:` + nonce. Inside: {`secret`, `name`, `boards`, `device`}.
Both screens show a 6-digit code: first 4 bytes of SHA-256(`pub`) as a number, mod 1,000,000.
The invite lasts 10 minutes. A second `join` on the same invite cancels the pairing.

### The `pta1.` answer token

This is how a Yes/No button on a notification answers, even with the app closed.
The service worker posts it as a plain ntfy message to the phone's normal mailbox topic.

```
"pta1." + id + "." + base64url( iv[12] | AES-256-GCM ciphertext | tag[16] )
plaintext = JSON { "a": "<choice name>", "ts": <ms> }
key       = the one-time key "k" that came inside the push (no AAD)
```

The computer checks: the `id` is a live question (30 min), it decrypts, and `ts` is within 30 min.
The `id` then dies (it works once). The phone only sends the choice name (`yes` / `no`).
What gets typed is decided on the computer (`choicesFor` in `core.js`).

## 3. Direct link messages

Every message is one JSON object with a `t` field.

**Size limit.** The computer's limit is the channel's max message size, kept between 16 KB and 200 KB, minus 1 KB.
Bigger messages: `reset` and `o` are split into pieces (the first piece stays `reset`, the rest are `o`).
`result` is cut to the end of its output. Any other message that is too big (a long `diff`, a folder with
many files) is sent packed if that fits (phones that sent `z: 1`), or else as numbered pieces:
`{ t: 'part', id, i, n, d }`, where `d` is a slice of the message's JSON text. The phone joins the `n` pieces
with the same `id` in order of `i` and handles the result as one message.

**Compression.** If the phone's `attach` says `z: 1`, the computer may send a message as a **binary** frame:
the JSON packed with deflate-raw. It does this only when the JSON is over 1 KB and packing saves at least 20%.
The phone unpacks binary frames with `DecompressionStream('deflate-raw')` and keeps strict order.
The phone always sends plain text.

**Output pacing.** Output (`o`) is gathered for up to 12 ms (sent at once after a 40 ms pause, so keystroke echoes are instant).
If more than 48 KB waits on the link, the computer drops the backlog. When the link is under 8 KB again it sends one `reset` with the current screen.

**Replies.** Many requests carry an `id` (made by the phone). The reply carries the same `id`, and errors come back as `{t, id, error}`.

### Phone → computer

| `t` | Fields | What it does |
|---|---|---|
| `attach` | `sid`, `fresh`, `cols`, `rows`, `z` | Sent first. Picks the session to show. `fresh: true` (a new app launch) closes this phone's other idle sessions. `z: 1` turns on compression. With no `attach` in 1.5 s, the computer uses session `shared` (for older phones). |
| `i` | `d` | Keys / pasted text for the current session. If the session's size differs from the phone's, it is resized first and the phone gets a clean screen. |
| `r` | `cols`, `rows` | The phone's terminal size changed. |
| `ping` | none | Keep-alive, every 5 s while the app is on screen. Also tells the computer "I'm still looking" (used to skip notifications). |
| `cmd` | `id`, `cmd` | Run one command by itself. The reply is `result`. (Note: `id` here, `cid` in the mailbox.) |
| `settings` | `power` | Same as the mailbox `settings` note. The reply is `power`. |
| `sessions` | none | List sessions. Reply: `sessions`. |
| `switch` | `sid`, `cols`, `rows` | Show another session (a new `sid` makes a new one). Reply: `reset`, `size`, `switched`. For a `Q-`/`C-` id, or an `L-` id that is gone, the reply is `sessions`. |
| `close-session` | `sid` | Close a session. Not the one on screen, and not a `Q-` question. Reply: `sessions`. |
| `answer` | `sid`, `d` | Answer a waiting session without opening it. For a terminal, `d` is what to type (1–16 characters, only while it is asking). For a `Q-` question, `d` must be `yes` or `no`. Reply: `answered`. |
| `reply` | `sid`, `text` | Answer in your own words (up to 500 characters). On a choice menu the computer presses Esc first, then types the text. Reply: `answered`. |
| `diff` | `id`, `sid` | `git diff` of that session's folder. Reply: `diff`. |
| `auto-get` | none | Read the auto-approve rules. Reply: `auto`. |
| `auto-set` | `cfg` {`enabled`, `allow`} | Save them (max 40 rules, 60 characters each). Reply: `auto`. |
| `push-sub` | `sub` {`endpoint`, `keys` {`p256dh`, `auth`}}, `quiet` | Save this phone's Web Push address (max 3 per phone). Only Apple, Google, Mozilla and Microsoft push hosts are accepted. Reply: `push-ok`. |
| `push-off` | `endpoint` | Forget a push address. Reply: `push-ok` with `off: true`. |
| `push-test` | none | Send a test notification. Reply: `push-tested`. |
| `ports` | `id` | Which localhost ports are listening (port ≥ 1024, max 40). Reply: `ports`. |
| `http` | `id`, `port`, `method`, `path`, `headers`, `body` (base64) | Fetch a page from this computer's localhost (127.0.0.1, then ::1). Cookies and `sec-*` headers are dropped. Body max 10 MB, response max 60 MB. Reply: `http-h`, then `http-c` pieces. |
| `ls` | `id`, `path`, `hidden` | List a folder (`~` works). Reply: `ls`. |
| `get` | `id`, `path` | Download a file (max 250 MB). Reply: `get-h`, then `get-c` pieces. |
| `get-cancel` | `id` | Stop a download. |
| `put` | `id`, `dir`, `name`, `size` | Start an upload (max 250 MB). Reply: `put-ok`. |
| `put-c` | `id`, `d` (base64) | One piece (the phone sends 32 KB pieces). |
| `put-end` | `id` | Upload done. Reply: `put-done`. |
| `put-cancel` | `id` | Stop an upload; the part file is deleted. |
| `share` | `minutes`, `canAnswer` | Make a view-only link for the session on screen (5 min to 24 h). Reply: `share`. |
| `shares` | none | List this phone's live links. Reply: `shares`. |
| `unshare` | `id` | Stop a link. Reply: `shares`. |

### Computer → phone

| `t` | Fields | What it does |
|---|---|---|
| `hi` | owner: `os`, `push`, `sid` · viewer: `os`, `viewer: true`, `canAnswer`, `name` · both: `proto` and `v` (the computer's Pocket Terminal version; see section 8) | Hello after `attach`. `push` is the computer's VAPID public key (or null). `sid` is the session being shown. |
| `reset` | `d` | Clear the screen and draw `d` (the session's saved output, up to 256 KB). |
| `o` | `d` | New terminal output. |
| `size` | `cols`, `rows` | The session's real size. A viewer scales its screen to match. |
| `exit` | `code` | The shell or program in the session ended. (The phone does not use it yet.) |
| `power` | `percent`, `onCharger`, `mode`, `checkInMinutes`, `nextCheckInMinutes`, `awake`, `reasons`, `nextWake`, `settings` | Battery and why the computer is staying awake. |
| `alert` | `kind`, `sid`, `program`, and by kind: `text`, `menu`, `ask`, `cwd`, `choices`, `rule`, `seconds`, `changes`, `last` | Something happened. `kind`: `input` (needs you), `done` (a program finished; `seconds`, `changes` {`files`, `add`, `del`, `fresh`}, `last`: up to 3 of the last lines it printed, without the prompt or anything that looks like a secret), `quiet` (Windows: output stopped), `auto` (auto-approved; `rule`), `gone` (the question went away). Comes for the session on screen, and for every `Q-`/`C-` id. |
| `pong` | none | Reply to `ping`. The phone shows the round-trip time. |
| `result` | `id`, `code`, `out` | A `cmd` finished (output max 64 KB, 10 min time limit). Sent to every open link of this phone. |
| `sessions` | `list`, `current` | All sessions this phone can see. Each item: `sid`, `program`, `busy`, `running`, `waiting`, `lastOut`, `created`, `viewers`, `line`, `question`, `menu`, `askedAt`, `since`, `done`, `cwd`; `ask: true` for a `Q-` question; `ext: true` and `agent` for a `C-` agent. |
| `switched` | `sid` | The switch worked. The phone saves `sid` as its own. |
| `answered` | `sid`, `ok` | Result of `answer` or `reply`. (A viewer's `answered` has no `sid`.) |
| `diff` | `id`, `folder`, `diff`, `cut`, `fresh` or `id`, `error` | The change list (cut at 200 KB), and new files not in git yet (max 100). |
| `auto` | `enabled`, `allow` | The auto-approve rules. |
| `push-ok` | `quiet`, or `off: true`, or `error` | Push address saved, removed, or refused. |
| `push-tested` | `how` (`push` / `ntfy` / `none`) | How the test went out. |
| `ports` | `id`, `list` [{`port`, `name`}] | Listening ports. |
| `ls` | `id`, `path`, `parent`, `home`, `sep`, `entries` [{`n`, `d`, `s`, `m`}], `more` | A folder: name, is-folder, size, modified time. Max 2000 entries. |
| `get-h` | `id`, `name`, `size` | Download starts. |
| `get-c` | `id`, `n`, `d` (base64), `end` | One 32 KB piece. The last one has `end: true` and no `d`. |
| `put-ok` | `id`, `path` | Ready for pieces. |
| `put-done` | `id`, `path` | File saved (it was written as `.name.part`, then renamed). |
| `http-h` | `id`, `status`, `headers` | Response head. Headers that break the preview frame (CSP, X-Frame-Options, Set-Cookie, …) are removed. |
| `http-c` | `id`, `n`, `d` (base64), `end`, or `error` | One 32 KB piece of the body. |
| `share` | `id`, `link`, `expires` | The new view-only link. |
| `shares` | `list` [{`id`, `expires`, `canAnswer`, `sid`}] | This phone's live links. |
| `share-ended` | none | (To a viewer.) The link was stopped or expired. |
| `revoked` | none | This phone was removed. |

## 4. Web Push payload

The computer sends one JSON object per notification (`agent/direct.js`, `notify`). The service worker (`sw.js`) shows it.

| Field | Meaning |
|---|---|
| `title` | e.g. "Claude Code asks for permission", "Npm finished", "MacBook is awake ✓", "Notifications work ✅" |
| `body` | One line of detail. |
| `sid` | The session it is about, or null. A tap opens the app at `#s=<sid>`. A `Q-`/`C-` id opens the Agents dashboard instead. |
| `kind` | `input`, `done`, `quiet`, `ready`, or `test`. An `input` notification stays on screen until touched. |
| `tag` | `pt-<sid>`, or `pt-ready`. A newer notification with the same tag replaces the old one. |
| `ans` | Only for `input`, when the question has one-tap choices. See below. |

`ans` fields:

| Field | Meaning |
|---|---|
| `id` | One-time question id (9 random bytes, base64url). |
| `k` | One-time 32-byte AES key (base64url) for the `pta1.` token. |
| `b` | The first board URL. |
| `tp` | The phone's mailbox topic. |
| `acts` | Buttons: [{`action`: choice name, `title`: label}]. The browser may show fewer. |

The HTTP request uses `TTL: 3600`, `Urgency: high`, and a `Topic` header (`pt<sid>` or `ptready`, max 32 characters)
so a newer push replaces an older one still waiting at the push service.

When to notify: never for `auto` or `gone`, never from a viewer. Not when the phone is showing that session and sent a message in the last 12 s.
Not twice for the same session and kind within 20 s. If no Web Push address works (and `notify` is not turned off), a content-free ping goes to the notify topic instead.

## 5. Local socket

`agent/lib/local.js`. The socket is `~/.pocket-terminal/ctl.sock` (mode 600). On Windows it is the named pipe
`\\.\pipe\pocket-terminal-<first 16 hex of sha256(folder path)>`.
A new random token is written to `ctl.token` (mode 600) each time the agent starts.

Messages are JSON, one per line. The **first** line must carry `token` and the request. A wrong token closes the connection.
No first line within 10 s also closes it. Lines over 1 MB in total close it.

| First message | Fields | What happens |
|---|---|---|
| `event` | `agent`, `session`, `cwd`, `kind` (`busy` / `stop`), `away` | An agent outside Pocket Terminal is working or finished. It shows as a `C-` entry. A `stop` after 20 s or more of work sends a `done` alert, if `away` is not false. Reply: `{ok: true}`, then the socket closes. |
| `ask` | `agent`, `text`, `cwd` | A permission question. It shows as a `Q-` entry with Allow/Deny. The socket stays open. When answered, the reply is `{t: 'decision', v}` with `v` = `yes`, `no` or null. Closing the socket withdraws the question. |
| `run` | `cmd` (max 4000), `cwd`, `env`, `cols`, `rows` | Start a command in a new `L-` session. Reply: `{t: 'started', sid}`. Then the computer sends `{t: 'o', d}` and `{t: 'exit', code}`. The client sends `{t: 'i', d}` (keys) and `{t: 'r', cols, rows}`. Typing from this window resizes the session back to this window's size. Closing the window leaves the session running. |

### Claude Code hook outputs (`agent/hook.js`)

The hook reads one Claude Code event from stdin. It does nothing inside a Pocket Terminal session (`POCKET_TERMINAL=1`),
so nothing is reported twice. Settings come from `~/.pocket-terminal/claude.json` (`mode`: `away` / `always` / `off`, `awaySeconds`, default 60).

| Claude Code event | What the hook does | What it prints |
|---|---|---|
| `PermissionRequest` | If you are away (no keyboard or mouse for `awaySeconds`), sends `ask`. Waits up to 50 min. Gives the question back to the screen when you return (idle < 3 s), or after 45 s if idle time is unknown. | Allow: `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`. Deny: same with `"behavior":"deny","message":"Denied from Pocket Terminal on the phone."`. Anything else: nothing (Claude asks on screen as usual). |
| `UserPromptSubmit`, `PreToolUse`, `PostToolUse` | Sends `event` with `kind: busy`. | nothing |
| `Stop`, `SessionEnd` | Sends `event` with `kind: stop` and `away`. | nothing |

The hook always exits 0. If the agent is not running, it exits at once.

## 6. Session ids

The phone uses a short `sid`. The computer turns it into a **key**. Ids are cleaned to letters, digits, `_` and `-`, max 40 characters.
An empty id becomes `shared`.

| `sid` looks like | Key on the computer | What it is | Who sees it |
|---|---|---|---|
| plain, e.g. `Kx3…` | `<deviceId>:<sid>` | A terminal this phone opened. One per app launch (kept in `sessionStorage`). | Only this phone. |
| `L-<10 hex>` | `local:L-…` | A terminal started on the computer with `npx pocket-terminal run`. | Every paired phone. |
| `Q-<8 chars>` | `local:Q-…` | A permission question from an agent's hook. Not a terminal: it can be answered, not opened or closed. | Every paired phone. |
| `C-<up to 12>` | `local:C-…` | An agent running outside Pocket Terminal (e.g. Claude Code in VS Code), known from its hooks. Not a terminal. Forgotten after 2 h of silence. | Every paired phone. |

A `local:` key belongs to the computer, not to one phone. So every phone gets its alerts, its sessions list entries and its notifications.
`deviceId` is the phone's id in `direct.json`. The computer keeps at most 8 terminal sessions and closes the oldest idle one first.

## 7. Viewer (share link) restrictions

A share link is `<app url>#watch=<secret>&name=<computer name>` (plus `boards=` if not the default).
The secret is a fresh 32-byte key with its own mailbox. The computer runs a separate `viewer` connection for it, tied to one session key.

A viewer computer:

- reads only `hello` and `offer` notes, and ignores `pta1.` tokens;
- on the link, reacts only to `ping`, `attach` (always shows the shared session), and, if the link was made with `canAnswer`, `answer` with `a` = a choice name. The computer turns the name into keys with `choicesFor`;
- ignores typing, resizing, commands, settings, files, websites, sessions, sharing and notifications;
- sends `hi` with `viewer: true`, then `alert` (`kind: input`) if the session is asking right now;
- never sends notifications and never keeps the computer awake.

The link ends when it expires, on `unshare`, or when its phone is removed. Then viewers get `share-ended`.

## 8. Versioning

- The computer announces **`proto`**, an integer, in its `hi` message (owner and viewer).
- The current value is **1**.
- **Bump `proto` whenever a message changes in a way an older phone or computer cannot handle**: a field is removed or renamed,
  its meaning changes, or a new message is required for things to work. Adding an optional field, or a new message that the
  other side may safely ignore, does not need a bump.
- The phone shows an update bar ("Computer runs v7.3.0 · tap to copy the update") when the computer's version `v` is older
  than the phone expects. A `hi` with no `proto` means a computer from before this rule (treat it as 0).
- Mailbox notes and the `pt1.` / `pta1.` formats carry their own version in the prefix. A new encryption format needs a new prefix.
- When you bump `proto`, update this page and the changelog in the same change.
