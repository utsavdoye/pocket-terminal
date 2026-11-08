// "Copy info" in Settings → About: what helps someone find a problem, and nothing private.
// No keys, no mailbox names, no commands, no screen contents.

import { $, toast } from '../core/dom.js';
import { APP_VERSION, isIOS, standalone } from '../core/env.js';
import { state, mac } from '../core/state.js';
import { computers } from '../core/computers.js';
import { on } from '../connection/messages.js';

let hi = {};
on('hi', (m) => { hi = { v: m.v || 'older than 7.4', proto: m.proto ?? 0, os: m.os }; });

export function debugInfo() {
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller ? 'yes' : 'no';
  let push = 'off'; try { push = 'Notification' in window ? Notification.permission : 'unsupported'; } catch {}
  return [
    `Pocket Terminal app ${APP_VERSION}`,
    `Computer: ${hi.v || 'not connected yet'}${hi.os ? ' on ' + hi.os : ''}, protocol ${hi.proto ?? '?'}`,
    `Link: ${state.linkState}${state.rtt !== null ? `, ${state.rtt} ms` : ''}, retries ${state.retryN}, board ${state.board ? state.board.up.size + ' up' : 'none'}`,
    `Computer state: ${mac.state || 'unknown'}${mac.ts ? `, heard ${Math.round((Date.now() - mac.ts) / 1000)} s ago` : ''}`,
    `Computers paired: ${computers().length}`,
    `Phone: ${navigator.userAgent}`,
    `Home Screen app: ${standalone ? 'yes' : 'no'}${isIOS ? ' (iPhone/iPad)' : ''}, offline cache: ${sw}, notifications: ${push}, online: ${navigator.onLine}`,
    `Screen: ${innerWidth}x${innerHeight} @${devicePixelRatio}, terminal ${state.term ? state.term.cols + 'x' + state.term.rows : '-'}`,
    `Time: ${new Date().toISOString()}`,
  ].join('\n');
}

export function setupDebug() {
  $('copyDebug').onclick = async () => {
    const text = debugInfo();
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it in a GitHub issue or a message.'); } catch { prompt('Copy this:', text); }
  };
  $('copyActivity').onclick = async () => { try { await navigator.clipboard.writeText('npx pocket-terminal activity'); toast('Copied. Run it on your computer.'); } catch { toast('Run on your computer: npx pocket-terminal activity'); } };
}
