// Pocket Terminal phone app: the tools around the terminal.
//   Agents      a dashboard of every terminal: who needs you (answer right there), what's working, what finished;
//               switch, close, share a view-only link
//   Needs you   a program asks something (an AI agent's "Do you want to proceed?", [y/N]): answer in one tap
//   Notify      phone notifications straight from the computer (Web Push), tap to jump to that terminal
//   Files       browse, download to this phone, upload from it
//   Websites    open the computer's localhost:3000 here, through the encrypted link
//   Voice       say what you want in Ask
// ui/setup.js hands in `ctx` (the link, the menu, toasts…); nothing here talks to the network by itself.
// Each tool lives in its own file. `t` is how they reach each other: needs.js puts its answer
// buttons there, agents.js the dashboard refresh and the terminal on screen.

import { setupNeeds } from './needs.js';
import { setupAgents } from './agents.js';
import { setupSharing } from './sharing.js';
import { setupPush } from './push.js';
import { setupAutoApprove } from './auto-approve.js';
import { setupFiles } from './files.js';
import { setupWebsites } from './websites.js';
import { setupVoice } from './voice.js';
import { setupUpdate } from './update.js';

export function setupTools(ctx) {
  const t = {};
  setupNeeds(ctx, t);
  setupAgents(ctx, t);
  setupSharing(ctx, t);
  setupPush(ctx);
  setupAutoApprove(ctx);
  setupFiles(ctx);
  setupWebsites(ctx);
  setupVoice(ctx);
  setupUpdate(ctx);
  return { hideNeeds: t.hideNeeds, refreshSessions: t.refreshSessions };
}
