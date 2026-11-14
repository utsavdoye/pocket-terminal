# Terminal tabs, wide lines with a slider, and no junk at the prompt after a screen replay.
#   Run: python3 test/e2e_tabs.py
import subprocess, time, os, json, sys
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, R+'/test'); import pairing_helper as ph
from playwright.sync_api import sync_playwright
S=__import__('tempfile').mkdtemp()
svc=subprocess.Popen(['node','test/run-services.js','8922','8923',S+'/board.json'],cwd=R,stdout=subprocess.PIPE,text=True)
ports=json.loads(svc.stdout.readline()); BOARD=f"http://127.0.0.1:{ports['board']}"; APP=f"http://localhost:{ports['app']}/app/"
os.makedirs(S+'/home'); env=dict(os.environ,POCKET_HOLDER='0',POCKET_HOME=S+'/home',POCKET_APP_URL=APP,SHELL='/bin/bash')
ph.setup(R, env, 'Mac', BOARD); ag=subprocess.Popen(['node','agent.js'],cwd=R+'/agent',env=dict(env,POWER_BRAIN='0'),stdout=open(S+'/a.log','w'),stderr=subprocess.STDOUT)
def wait(f,t=20):
    t0=time.time()
    while time.time()-t0<t:
        try:
            v=f()
            if v: return v
        except Exception: pass
        time.sleep(0.3)
ok=True
def check(n,l,v):
    global ok; ok=ok and bool(v); print(n,l,bool(v))
    if not v: ph.ci(f'check {n} failed: {l}')
try:
  with sync_playwright() as p:
    b=p.chromium.launch(args=['--disable-features=WebRtcHideLocalIpsWithMdns']); ctx=b.new_context(**p.devices['iPhone 13']); pg=ctx.new_page()
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    ph.pair(pg, R, env); wait(lambda: 'awake' in (pg.get_attribute('#presence','class') or ''), 40)
    check(1,'tabs show for the terminal', wait(lambda: pg.is_visible('#tTabs') and pg.locator('#tTabs .tt[data-tab]').count()==1, 15))
    pg.click('#tTabs [data-tabnew]'); time.sleep(1.5)
    check(2,'+ makes a second tab, now on screen', wait(lambda: pg.locator('#tTabs .tt[data-tab]').count()==2 and 'on' in pg.get_attribute('#tTabs .tt[data-tab]:nth-child(2)','class'), 15))
    pg.click('#tTabs .tt[data-tab]:nth-child(1)')
    check(3,'tap tab 1 goes back', wait(lambda: 'on' in pg.get_attribute('#tTabs .tt[data-tab]:nth-child(1)','class'), 10))
    # junk from a replay: a program asked for the colour, the screen is replayed later
    pg.click('#term'); pg.keyboard.type("printf '\\033]11;?\\007\\033[6n'; read -rs -t 2 -d R x; read -rs -t 1 x; echo asked\n"); time.sleep(4)
    pg.keyboard.type('clear\n'); time.sleep(0.5)
    pg.click('#tTabs .tt[data-tab]:nth-child(2)'); time.sleep(1.5); pg.click('#tTabs .tt[data-tab]:nth-child(1)'); time.sleep(2)
    pg.click('#term'); pg.keyboard.type('echo after\n'); time.sleep(1)
    t=pg.evaluate('window.ptText()')
    check(4,'no colour/cursor answers typed at the prompt after a replay', 'rgb:' not in t and ';1R' not in t)
    # wide lines
    pg.click('#tTabs [data-wide]'); time.sleep(1)
    pg.click('#term'); pg.keyboard.type('echo ' + 'A'*60 + 'B'*60 + 'END\n'); time.sleep(1)
    t=pg.evaluate('window.ptText()')
    check(5,'wide: a long line stays on one line', any(('A'*60+'B'*60+'END') in l for l in t.split('\n')))
    check(6,'wide: the slider shows', pg.is_visible('#hPan'))
    pg.evaluate("(()=>{const s=document.getElementById('hPan'); s.value=s.max; s.dispatchEvent(new Event('input'))})()"); time.sleep(0.3)
    check(7,'wide: the slider moves along the line', pg.evaluate("getComputedStyle(document.querySelector('#term .xterm')).transform") not in ('none',''))
    pg.click('#tTabs [data-wide]'); time.sleep(1)
    check(8,'wide off: the slider hides and lines fit again', not pg.is_visible('#hPan'))
    check(9,'no page errors', not errs); print(errs)
    print('ALL OK' if ok else 'FAILED')
finally:
    ag.kill(); svc.kill()
