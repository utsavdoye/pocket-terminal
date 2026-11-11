# Through a relay (TURN), end to end, with a real relay server (coturn) standing in for the one
# the board hands out (Metered or Cloudflare). This is what makes the app work on mobile data and strict Wi-Fi, where a direct link
# is blocked. Phase 1: the phone may only use the relay. Phase 2: both sides may only use it.
#   Run: python3 test/e2e_relay.py      (needs coturn: apt install coturn; skipped without it)
import subprocess, time, os, json, signal, sys, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import pairing_helper as ph
from playwright.sync_api import sync_playwright
if not shutil.which('turnserver'): print('turnserver (coturn) not installed: skipped'); print('ALL OK'); sys.exit(0)
# The relay runs on this machine's network address (not 127.0.0.1: a relay bound to loopback can't
# reach the computer's own address, which a real relay on the internet of course can).
IP=(subprocess.run(['hostname','-I'],capture_output=True,text=True).stdout.split() or ['127.0.0.1'])[0]
S=__import__('tempfile').mkdtemp(); os.makedirs(S+'/home'); R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
turn=subprocess.Popen(['turnserver','-n',f'--listening-ip={IP}',f'--relay-ip={IP}','--listening-port=3488','--min-port=49400','--max-port=49500',
  '--lt-cred-mech','--user=u1:c1/+=','--realm=pt','--allow-loopback-peers','--no-tls','--no-dtls','--no-cli','--fingerprint','--log-file=stdout','--simple-log','--verbose'],
  stdout=open(S+'/turn.log','w'), stderr=subprocess.STDOUT)
ICE=[{'urls':[f'turn:{IP}:3488?transport=udp',f'turn:{IP}:53?transport=udp'],'username':'u1','credential':'c1/+='}]
svc=subprocess.Popen(['node','test/run-services.js','8898','8899',S+'/board.json'],cwd=R,stdout=subprocess.PIPE,text=True,env=dict(os.environ,MOCK_TURN_ICE=json.dumps(ICE)))
ports=json.loads(svc.stdout.readline()); BOARD=f"http://127.0.0.1:{ports['board']}"; APP=f"http://localhost:{ports['app']}/app/"
env=dict(os.environ,POCKET_HOME=S+'/home',POCKET_APP_URL=APP,SHELL='/bin/bash')
ph.setup(R, env, 'TestMac', BOARD)
def start_agent(extra={}):
    return subprocess.Popen(['node','agent.js'],cwd=R+'/agent',env=dict(env,POWER_BRAIN='0',**extra),stdout=open(S+'/agent.log','a'),stderr=subprocess.STDOUT)
agent=start_agent()
ROWS="window.ptText()"
awake=lambda pg: 'awake' in (pg.get_attribute('#presence','class') or '')
def wait(fn, t=20):
    t0=time.time()
    while time.time()-t0<t:
        try:
            v=fn()
            if v: return v
        except Exception: pass
        time.sleep(0.25)
ok=True
def check(n, label, v):
    global ok; ok = ok and bool(v); print(f'{n} {label}:', v if isinstance(v,str) else bool(v))
    if not v: ph.ci(f'check {n} failed: {label}')
route=lambda pg: pg.evaluate("document.getElementById('connInfo').textContent")
try:
  with sync_playwright() as p:
    b=p.chromium.launch(args=['--disable-features=WebRtcHideLocalIpsWithMdns'])
    ctx=b.new_context(**p.devices['Pixel 7']); pg=ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    ph.pair(pg, R, env); wait(lambda: awake(pg), 40)
    check(1, 'the app fetched a relay login from the board', pg.evaluate('window.ptRelay'))
    # Phase 1: the phone may only use the relay (like a phone on mobile data)
    pg.evaluate("localStorage.setItem('pt_relayOnly','true')"); t0=time.time(); pg.reload()
    con=wait(lambda: awake(pg), 40); took=time.time()-t0
    check(2, 'phone through the relay only: it connects', con and f'{took:.1f} s after opening')
    check(3, 'and says it goes through the relay', wait(lambda: 'relay' in route(pg), 5) and route(pg))
    pg.click('#term'); pg.keyboard.type('echo via-relay-$((40+2))\n')
    check(4, 'the terminal works through the relay', wait(lambda: 'via-relay-42' in pg.evaluate(ROWS), 10))
    # Phase 2: the computer may only use the relay too (it fetches its own login from the board)
    agent.terminate(); agent.wait(10)
    f=S+'/home/direct.json'; cfg=json.load(open(f)); cfg.pop('iceServers',None); json.dump(cfg,open(f,'w'))
    agent=start_agent({'POCKET_RELAY_ONLY':'1'}); time.sleep(2)
    t0=time.time(); pg.reload(); con=wait(lambda: awake(pg), 40); took=time.time()-t0
    check(5, 'both sides through the relay only: it connects', con and f'{took:.1f} s after opening')
    pg.click('#term'); pg.keyboard.type('echo both-relay-$((40+3))\n')
    check(6, 'and the terminal works', wait(lambda: 'both-relay-43' in pg.evaluate(ROWS), 10))
    log=open(S+'/agent.log').read()
    check(7, 'the computer answered with the relay ready', 'relay ready' in log)
    tl=open(S+'/turn.log').read()
    check(8, 'the relay server really carried it', 'allocation' in tl.lower() and 'success' in tl.lower())
    check(9, 'no page errors', not errs)
    if not ok: print(log[-2500:]); print(tl[-1500:])
    print('ALL OK' if ok else 'FAILED')
    b.close()
finally:
  try: agent.terminate()
  except Exception: pass
  svc.terminate(); turn.terminate()
