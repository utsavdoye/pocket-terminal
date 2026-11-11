# Pocket Terminal's message board

A tiny service on Cloudflare Workers that does what ntfy.sh does for Pocket Terminal: it holds
encrypted notes so a phone and a computer can find each other. It never sees anything readable.

Why not just ntfy.sh? The free ntfy.sh allows a few hundred messages a day **per internet
connection**. Everyone on the same college, office or mobile network shares that, so one busy
network can lock people out. This board limits each mailbox instead, and ntfy.sh stays as the
backup: the app and the agent post to both and read from both.

## Put it online (once, about 5 minutes)

You need a free Cloudflare account (cloudflare.com). No card is needed for the free plan.

```bash
cd board
npx wrangler login      # opens the browser: log in and click Allow
npx wrangler deploy     # prints the address, like https://pocket-terminal-board.NAME.workers.dev
cd ..
node scripts/set-board.js https://pocket-terminal-board.NAME.workers.dev
```

`set-board.js` checks that the board answers, then writes its address into the phone app and the
agent. Commit, push and release as usual. Phones and computers that update start using it by
themselves; nobody has to pair again.

## Networks that block a direct link

Some networks block a direct link between phone and computer: Indian mobile data and many office
and college networks put lots of people behind one shared address. When the direct link doesn't
open within a couple of seconds, the phone and the computer each open a WebSocket to their mailbox
here (`/{topic}/pipe`) and the board passes the terminal between them. Every message is sealed
with the pairing key and numbered, so the board (and anyone watching it) can't read, change,
replay or reorder anything. Nothing to set up: it's part of the board.

What it uses on Cloudflare's free plan: one request per message received from the phone or the
computer, counted 20 messages to 1 request, plus the time the mailbox is busy passing messages
along. The free plan allows 100,000 requests and 13,000 GB-seconds a day, roughly 25 to 30 hours
of busy relayed terminals a day across everyone. If a day's allowance runs out, those phones use
the slower backup route until midnight UTC. With no card on the account, nothing is ever charged.

### Optional: a TURN relay instead

If you'd rather use a TURN relay service, the board can hand out its logins (`/{topic}/ice`):
Metered Open Relay (free account, 20 GB a month: `npx wrangler secret put METERED_URL` with
`https://APPNAME.metered.live/api/v1/turn/credentials?apiKey=APIKEY`) or Cloudflare Realtime
(card needed: `TURN_KEY_ID` and `TURN_KEY_TOKEN`). Then deploy. Not needed for anything above.

## What it costs

Cloudflare's free plan allows 100,000 requests a day. If a day's allowance ever runs out, the
board refuses requests until midnight UTC and everything carries on through ntfy.sh. The paid
plan starts at $5 a month.

## Test it locally

```bash
cd board && npx wrangler dev --port 8787
BOARD_URL=http://127.0.0.1:8787 node test/board-worker.test.js
POCKET_TEST_BOARD=http://127.0.0.1:8787 python3 test/e2e_mobile.py    # the whole app against it
```

## What it stores

Per mailbox (a random name like `pt-…`): up to 200 encrypted notes, each for 12 hours, then
nothing. No accounts, no IP addresses, no logs of note contents.
