// The app's shared, changing state, in one place. Modules read and write `state.x` (and `mac`)
// instead of keeping their own copies, so everyone sees the same link, terminal and session.

import { randomId } from '../crypto.js';

export const state = {
  S: null, // the open session: key, topics, boards, computer name (viewer: true for a shared live view)
  keys: null, // { key, topic, notifyTopic } for sealing and opening notes
  board: null, // the message board (this phone's private mailbox)
  term: null, fit: null, gpu: null, // the xterm terminal, its fit-to-screen addon, and the WebGL drawing (null: plain drawing)
  // the direct link
  // route: 'direct', 'relay' (a TURN relay) or 'board' (the board's pipe)
  pipe: null, pipeTimer: null, // the link through the board's pipe, when a network blocks a direct one
  pc: null, dc: null, route: null, linkState: 'idle', lastAttempt: 0, offerAt: 0, answerTimer: null, openTimer: null,
  lastPong: 0, pingSent: 0, rtt: null,
  ended: false, // a shared live view that has ended: stop reconnecting
  retryN: 0, retryTimer: null,
  livePower: null, // power info sent live over the link (fresher than the board's)
  SID: null, attachFresh: true, // this launch's terminal session
  openAgentsSoon: false, // opened from an agent's notification: show the dashboard once connected
};

// What we last heard about the computer.
export const mac = { state: null, ts: 0, nextWake: null, checkIn: null, power: null, name: '' };

// One terminal session per app launch: switching apps and coming back continues it; a fresh
// launch (the app was closed) gets a fresh terminal. sessionStorage ends when the app is closed.
try { state.SID = sessionStorage.getItem('pt_sid'); if (!state.SID) { state.SID = randomId(); sessionStorage.setItem('pt_sid', state.SID); } } catch { state.SID = randomId(); }
export function setSid(v) { state.SID = String(v).replace(/[^\w-]/g, '').slice(0, 40) || state.SID; try { sessionStorage.setItem('pt_sid', state.SID); } catch {} }
