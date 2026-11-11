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
