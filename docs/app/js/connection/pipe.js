// The live terminal through our own message board, for networks that block a direct link
// (mobile data in India, many office and college Wi-Fi networks).
//
// A PipeChannel behaves like the direct link's data channel (readyState, send, onopen, onmessage,
// onclose, bufferedAmount), so everything else in the app works the same over it. It is a
// WebSocket to the board; the board passes each message to the computer and back. Every message
// is sealed with the pairing key (the board sees only scrambled text) and numbered, so nobody in
// the middle can replay, reorder or bounce one back.

import { seal, open } from '../crypto.js';
import { state } from '../core/state.js';
import { ownBoard } from '../core/env.js';

export const pipeUrl = (id) => {
  const own = state.S && ownBoard(state.S.boards);
  return own ? `${own.replace(/^http/, 'ws')}/${state.S.topic}/pipe?id=${id}&side=phone` : null;
};

export class PipeChannel {
  constructor(id, url) {
    Object.assign(this, { pipe: true, id, readyState: 'connecting', binaryType: 'arraybuffer', onopen: null, onmessage: null, onclose: null, bufferedAmountLowThreshold: 0 });
    this._pending = 0; this._low = []; this._tx = Promise.resolve(); this._rx = Promise.resolve(); this._nOut = 0; this._nIn = 0;
    const ws = (this.ws = new WebSocket(url));
    ws.onmessage = (e) => {
      const t = typeof e.data === 'string' ? e.data : '';
      if (!t || t === 'pong') return;
      if (t[0] === '{') { // from the board itself
        let c; try { c = JSON.parse(t); } catch { return; }
        if (c.pipe === 'ready' && this.readyState === 'connecting') { this.readyState = 'open'; clearTimeout(this._giveUp); this.onopen && this.onopen(); }
        if (c.pipe === 'closed') this.close();
        return;
      }
      this._rx = this._rx.then(() => open(state.keys, t)).then((m) => {
        if (!m || m.p !== this.id || m.s !== 'mac' || m.n !== this._nIn) return; // not ours, replayed or out of order
        this._nIn++; this.onmessage && this.onmessage({ data: m.d });
      }).catch(() => {});
    };
    ws.onclose = () => this._end();
    ws.onerror = () => { this._end(); try { ws.close(); } catch {} };
    this._giveUp = setTimeout(() => { if (this.readyState !== 'open') this.close(); }, 15e3); // the computer never joined
  }
  get bufferedAmount() { return this._pending + (this.ws.bufferedAmount || 0); }
  addEventListener(type, fn) { if (type === 'bufferedamountlow') this._low.push(fn); }
  send(str) {
    if (this.readyState !== 'open') return;
    const n = this._nOut++, len = str.length; this._pending += len;
    this._tx = this._tx.then(() => seal(state.keys, { p: this.id, s: 'phone', n, d: str }))
      .then((t) => { if (this.ws.readyState === 1) this.ws.send(t); }).catch(() => {})
      .finally(() => { this._pending -= len; if (this._low.length && this.bufferedAmount <= this.bufferedAmountLowThreshold) this._low.splice(0).forEach((f) => f()); });
  }
  close() { try { this.ws.close(); } catch {} this._end(); }
  _end() { if (this.readyState === 'closed') return; this.readyState = 'closed'; clearTimeout(this._giveUp); this.onclose && this.onclose(); }
}
