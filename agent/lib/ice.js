// The addresses the direct link tries, for the computer's side.
//
//   STUN (free, public): tells each side its address on the internet, so phone and computer
//   can reach each other directly. Works on most home Wi-Fi.
//   TURN (a relay, login from our board): for networks that block a direct link
//   (mobile data in India and many offices put lots of people behind one shared address).
//   The traffic is still end-to-end encrypted; the relay only passes it on.
//
// The relay login comes from our own board (GET /{topic}/ice), lasts 12 hours, and is kept in
// memory until it has under an hour left.

const { boardsFor, OWN_BOARD } = require('./board');
const STUN = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];
const cache = new Map(); // topic -> { servers, until }

// Cloudflare gives URLs like "turn:turn.cloudflare.com:3478?transport=udp". The link library on the
// computer only relays over UDP, so those are the ones it gets.
function toNdc(list) {
  const out = [];
  for (const s of list || []) {
    for (const u of [].concat(s.urls || [])) {
      const m = /^turn:([^:?]+):(\d+)(?:\?transport=(\w+))?$/.exec(u);
      if (!m || (m[3] && m[3] !== 'udp')) continue;
      out.push({ hostname: m[1], port: Number(m[2]), username: s.username, password: s.credential, relayType: 'TurnUdp' });
    }
  }
  return out.slice(0, 2);
}

async function relayFor(cfg, topic, log = () => {}) {
  const own = boardsFor(cfg.boards).find((b) => b !== 'https://ntfy.sh');
  if (!own || process.env.POCKET_NO_RELAY) return [];
  const c = cache.get(topic);
  if (c && c.until > Date.now() + (c.servers.length ? 3600e3 : 0)) return c.servers; // a login with an hour left; or "no relay here" until it expires
  try {
    const r = await fetch(`${own}/${topic}/ice`, { signal: AbortSignal.timeout(2500) });
    const d = await r.json();
    const servers = toNdc(d.iceServers);
    cache.set(topic, { servers, until: Date.now() + (Number(d.ttl) || 0) * 1000 });
    return servers;
  } catch (e) { log('relay login not available: ' + (e.message || e)); return c ? c.servers : []; }
}

// cfg.iceServers set by hand (tests, or someone's own setup) is used as it is.
async function iceServers(cfg, topic, log) {
  if (Array.isArray(cfg.iceServers)) return cfg.iceServers;
  return [...STUN, ...(await relayFor(cfg, topic, log))];
}

module.exports = { iceServers, toNdc, STUN, OWN_BOARD };
