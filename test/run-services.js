// Starts a mock board + the phone app server, prints their ports as JSON.
const { startBoard } = require('./mock-board');
const { startStatic } = require('./static-server');
(async () => {
  const b = await startBoard(Number(process.argv[2] || 0)); const s = await startStatic(Number(process.argv[3] || 0));
  console.log(JSON.stringify({ board: b.port, app: s.port }));
  // Tests read this file while it's being rewritten: write a temp file and rename it, so a reader
  // never sees it half-written (an empty read crashed a test on GitHub now and then).
  const fs = require('fs'), out = process.argv[4];
  setInterval(() => { if (!out) return; fs.writeFileSync(out + '.tmp', JSON.stringify([...b.topics.values()].flat())); fs.renameSync(out + '.tmp', out); }, 1000);
})();
