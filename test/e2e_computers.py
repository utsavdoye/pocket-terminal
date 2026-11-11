# Several computers on one phone, end to end: pair two computers, switch between them from the
# header, each keeps its own terminal, remove one. Plus the update bar and swiping between terminals.
#   Run: python3 test/e2e_computers.py
import subprocess, time, os, json, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import pairing_helper as ph
from playwright.sync_api import sync_playwright
S=__import__('tempfile').mkdtemp(); R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
svc=subprocess.Popen(['node','test/run-services.js','8894','8895',S+'/board.json'],cwd=R,stdout=subprocess.PIPE,text=True)
ports=json.loads(svc.stdout.readline()); BOARD=f"http://127.0.0.1:{ports['board']}"; APP=f"http://localhost:{ports['app']}/app/"
agents=[]; envs={}
for name in ['Laptop','Desktop']:
    h=S+'/'+name; os.makedirs(h+'/home'); os.makedirs(h+'/u')
    env=dict(os.environ,POCKET_HOME=h+'/home',POCKET_APP_URL=APP,SHELL='/bin/bash'); envs[name]=env
    ph.setup(R, env, name, BOARD)
    agents.append(subprocess.Popen(['node','agent.js'],cwd=R+'/agent',env=dict(env,POWER_BRAIN='0',HOME=h+'/u'),stdout=open(h+'/agent.log','w'),stderr=subprocess.STDOUT))
ROWS="window.ptText()"
awake=lambda pg: 'awake' in (pg.get_attribute('#presence','class') or '')
def wait(fn, t=20):
    t0=time.time()
    while time.time()-t0<t:
        try:
            v=fn()
            if v: return v
        except Exception: pass
        time.sleep(0.3)
ok=True
def check(n, label, v):
    global ok; ok = ok and bool(v); print(f'{n} {label}:', bool(v))
    if not v: ph.ci(f'check {n} failed: {label}')
def typ(pg, s): pg.click('#term'); pg.keyboard.type(s)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(args=['--disable-features=WebRtcHideLocalIpsWithMdns'])
    ctx=b.new_context(**p.devices['Pixel 7']); pg=ctx.new_page()
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    ph.pair(pg, R, envs['Laptop']); check(1, 'paired with the first computer', wait(lambda: awake(pg) and 'Laptop' in pg.inner_text('#macName'), 40))
    typ(pg, 'echo on-laptop-$((40+2))\n')
    check(2, 'its terminal works', wait(lambda: 'on-laptop-42' in pg.evaluate(ROWS), 10))

    # Pair the second computer: the phone asks to ADD it (not replace), then opens it.
    pp, link = ph.start_invite(R, envs['Desktop'])
    pg.goto('about:blank'); ph.open_link(pg, link)  # like opening the link from the camera
    check(3, 'a second pairing link offers to add the computer', wait(lambda: pg.is_visible('#replaceNote') and 'Add Desktop' in pg.inner_text('#replaceYes'), 8))
    pg.click('#replaceYes'); pg.wait_for_selector('#joinBox:not([hidden])')
    ph.read_until(pp, 'Its code:'); pp.stdin.write('y\n'); pp.stdin.flush()
    pg.wait_for_selector('#pairPad:not([hidden])', timeout=20000)
    for _ in range(2): pg.keyboard.type('654321'); pg.keyboard.press('Enter')
    pp.stdout.read(); pp.wait(5)
    check(4, 'now on the second computer', wait(lambda: awake(pg) and 'Desktop' in pg.inner_text('#macName'), 40))

    # The switcher: tap the name at the top.
    pg.click('.who'); pg.wait_for_selector('#pane-computers.on')
    names=pg.inner_text('#compList')
    check(5, 'the list shows both computers, the second in use', 'Laptop' in names and 'Desktop' in names and 'in use' in pg.inner_text('#compList .comp.cur'))
    pg.click('#compList [data-go]')
    # back on the first: its PIN session was kept for 12 h, so no PIN needed
    check(6, 'switching opens the first computer again (no PIN: still unlocked)', wait(lambda: awake(pg) and 'Laptop' in pg.inner_text('#macName'), 40))
    check(7, 'its own terminal is still there', wait(lambda: 'on-laptop-42' in pg.evaluate(ROWS), 10))
    check(8, 'no update bar: the computer runs the same version as the app', pg.is_hidden('#updBar'))

    # Swipe left on the terminal: the next terminal.
    ph.nav(pg, 'sessions'); pg.click('#sessNew'); time.sleep(1.5)
    typ(pg, 'echo second-term\n'); time.sleep(1)
    before=pg.evaluate(ROWS)
    box=pg.query_selector('#term').bounding_box(); y=box['y']+box['height']/2
    pg.evaluate("""([x0,x1,y]) => { const el=document.getElementById('term'); const T=(x)=>new Touch({identifier:1,target:el,clientX:x,clientY:y});
      el.dispatchEvent(new TouchEvent('touchstart',{touches:[T(x0)],bubbles:true,cancelable:true}));
      for (let i=1;i<=6;i++) el.dispatchEvent(new TouchEvent('touchmove',{touches:[T(x0+(x1-x0)*i/6)],bubbles:true,cancelable:true}));
      el.dispatchEvent(new TouchEvent('touchend',{touches:[],bubbles:true,cancelable:true})); }""", [box['x']+box['width']-30, box['x']+30, y])
    check(9, 'swiping switches to the other terminal', wait(lambda: 'on-laptop-42' in pg.evaluate(ROWS) and 'second-term' not in pg.evaluate(ROWS), 8))

    # Remove the second computer from this phone.
    pg.click('.who'); pg.wait_for_selector('#pane-computers.on')
    pg.once('dialog', lambda d: d.accept())
    pg.click('#compList [data-rm]')
    check(10, 'removing the other computer leaves only this one', wait(lambda: 'Desktop' not in pg.inner_text('#compList'), 5) and 'Laptop' in pg.inner_text('#compList'))
    check(11, 'the phone keeps one computer stored', len(pg.evaluate("JSON.parse(localStorage.getItem('pt_computers'))"))==1)
    check(12, 'no page errors', not errs)
    if not ok:
        for name in envs: print(name, open(S+'/'+name+'/agent.log').read()[-1500:])
    print('ALL OK' if ok else 'FAILED')
finally:
    for a in agents: a.kill()
    svc.kill()
