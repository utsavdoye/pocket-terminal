// start(): opens the app for an unlocked session (or a shared live view): the terminal, the
// controls around it, this phone's mailbox on the board, and the direct link.

import { Board } from '../board.js';
import { $, show } from '../core/dom.js';
import { state, mac } from '../core/state.js';
import { boardsFor } from '../core/env.js';
import { setupTerminal } from '../terminal/term.js';
import { setupUi } from '../ui/setup.js';
import { paint } from '../ui/status.js';
import { loadAi } from '../features/ai.js';
import { onNoteText } from './notes.js';
import { connect, watchLink, prefetchRelay } from './link.js';

export function start(session) {
  const S = (state.S = session); state.keys = { key: S.key, topic: S.topic, notifyTopic: S.notifyTopic };
  mac.name = S.name;
  show('app');
  $('notifyTopic').textContent = S.notifyTopic;
  setupTerminal(); setupUi();
  if (!S.viewer) loadAi();
  state.board = new Board(boardsFor(S.boards), S.topic, onNoteText, () => paint());
  state.board.start('12h'); // read the last 12 h: Mac status, answers to old commands
  prefetchRelay(); // the relay login, in parallel with the board
  setTimeout(() => connect(), 400);
  setInterval(paint, 1000);
  watchLink();
}
