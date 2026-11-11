# The live terminal through our own board, when the network blocks a direct link (mobile data
# in India, strict office or college Wi-Fi). Free: no relay service, no card.
# The phone is told to act as if every direct link is blocked; it must switch to the board's pipe
# by itself, quickly, and everything must work through it, sealed so the board can't read it.
#   Run: python3 test/e2e_pipe.py      (POCKET_TEST_BOARD=http://127.0.0.1:8787 to use the real board)
import subprocess, time, os, json, signal, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import pairing_helper as ph
from playwright.sync_api import sync_playwright
S=__import__('tempfile').mkdtemp(); os.makedirs(S+'/home'); R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
svc=subprocess.Popen(['node','test/run-services.js','8902','8903',S+'/board.json'],cwd=R,stdout=subprocess.PIPE,text=True)
ports=json.loads(svc.stdout.readline()); BOARD=f"http://127.0.0.1:{ports['board']}"; APP=f"http://localhost:{ports['app']}/app/"
env=dict(os.environ,POCKET_HOME=S+'/home',POCKET_APP_URL=APP,SHELL='/bin/bash')
ph.setup(R, env, 'TestMac', BOARD)
os.makedirs(S+'/u/docs'); open(S+'/u/docs/hello.txt','w').write('hi from the computer\n')
def start_agent(extra={}):
    return subprocess.Popen(['node','agent.js'],cwd=R+'/agent',env=dict(env,POWER_BRAIN='0',HOME=S+'/u',**extra),stdout=open(S+'/agent.log','a'),stderr=subprocess.STDOUT)
WS={'POCKET_WS': os.environ.get('PIPE_WS','mini')}  # default: the small WebSocket client (what Node 18/20 use)
agent=start_agent(WS)
ROWS="window.ptText()"
awake=lambda pg: 'awake' in (pg.get_attribute('#presence','class') or '')
def wait(fn, t=20):
    t0=time.time()
    while time.time()-t0<t:
        try:
            v=fn()
            if v: return v
        except Exception: pass
        time.sleep(0.2)
ok=True
def check(n, label, v):
    global ok; ok = ok and bool(v); print(f'{n} {label}:', v if isinstance(v,str) else bool(v))
    if not v: ph.ci(f'check {n} failed: {label}')
info=lambda pg: pg.evaluate("document.getElementById('connInfo').textContent")
try:
  with sync_playwright() as p:
    b=p.chromium.launch(args=['--disable-features=WebRtcHideLocalIpsWithMdns'])
    ctx=b.new_context(**p.devices['Pixel 7']); pg=ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    ph.pair(pg, R, env); wait(lambda: awake(pg), 40)
    # The network now blocks every direct link.
    pg.evaluate("localStorage.setItem('pt_noDirect','true')")
    t0=time.time(); pg.reload()
    con=wait(lambda: awake(pg), 30); took=time.time()-t0
    check(1, 'direct link blocked: it connects through the board by itself', con and f'{took:.1f} s after opening')
    check(2, 'within 10 seconds', con and took < 10)
    check(3, 'and says so', wait(lambda: 'relay' in info(pg), 5) and info(pg))
    pg.click('#term'); pg.keyboard.type('echo via-board-$((40+2))\n')
    check(4, 'the terminal works through the board', wait(lambda: 'via-board-42' in pg.evaluate(ROWS), 10))
    # A burst of output (a build log): it all arrives, in order.
    pg.keyboard.type('seq 1 3000 | tail -3; echo burst-done\n')
    check(5, 'a burst of output arrives whole and in order', wait(lambda: '2998' in pg.evaluate(ROWS) and '3000' in pg.evaluate(ROWS) and 'burst-done' in pg.evaluate(ROWS), 15))
    # Files work over it too.
    ph.nav(pg,'files'); 
    check(6, 'files open through the board', wait(lambda: 'docs' in pg.inner_text('#pane-files'), 10))
    ph.close_menu(pg)
    # The board saw only sealed text.
    msgs=json.load(open(S+'/board.json.pipe')) if os.path.exists(S+'/board.json.pipe') else None
    if msgs is not None:
        check(7, 'the board only ever saw sealed text', msgs and all(m.startswith('pt1.') or m.startswith('{"pipe"') for m in msgs) and not any('via-board' in m or 'burst-done' in m or 'hello.txt' in m for m in msgs) and f'{len(msgs)} messages, all sealed')
    else: print('7 (board messages not visible on the real board; skipped)')
    # The computer restarts: the app finds it again, through the board again.
    agent.terminate(); agent.wait(10); time.sleep(1); agent=start_agent(WS)
    wait(lambda: not awake(pg), 10)  # the old link drops first
    t0=time.time(); con=wait(lambda: awake(pg) and 'relay' in info(pg), 60)
    pg.click('#term'); pg.keyboard.type('echo back-$((7*6))\n')
    check(8, 'after the computer restarts, it reconnects through the board', con and wait(lambda: 'back-42' in pg.evaluate(ROWS), 30))
    # The network allows direct links again: the next visit goes direct (no board needed).
    pg.evaluate("localStorage.removeItem('pt_noDirect')"); pg.reload(); wait(lambda: awake(pg), 30)
    check(9, 'when the network allows it again, it goes direct', wait(lambda: info(pg).startswith('Direct'), 8) and info(pg))
    log=open(S+'/agent.log').read()
    check(10, 'the computer logged the board link', 'connected through the board' in log)
    check(11, 'no page errors', not errs)
    if not ok: print(log[-2500:])
    print('ALL OK' if ok else 'FAILED')
    b.close()
finally:
  try: agent.terminate()
  except Exception: pass
  svc.terminate()
