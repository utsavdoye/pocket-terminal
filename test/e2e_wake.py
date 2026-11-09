# The sleeping laptop, end to end: lid closed on battery, it sleeps and wakes on its own schedule.
# The app says "wakes in N s" and really connects then; leave the app and you get "is awake".
#   Run: python3 test/e2e_wake.py
# The fake Mac (agent/test/sim-mac.js) freezes when it sleeps; a thread here plays the alarm clock:
# it un-freezes the agent at the exact time the agent set its wake alarm for.
import subprocess, time, os, json, signal, sys, threading, re
from datetime import datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import pairing_helper as ph
from playwright.sync_api import sync_playwright
S=__import__('tempfile').mkdtemp(); os.makedirs(S+'/home'); R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FULL=S+'/board-full'
svc=subprocess.Popen(['node','test/run-services.js','8896','8897',S+'/board.json'],cwd=R,stdout=subprocess.PIPE,text=True,env=dict(os.environ,MOCK_BOARD_FULL=FULL))
ports=json.loads(svc.stdout.readline()); BOARD=f"http://127.0.0.1:{ports['board']}"; APP=f"http://localhost:{ports['app']}/app/"
push=subprocess.Popen(['node','test/push-receiver.js'],cwd=R,stdout=subprocess.PIPE,text=True); SUB=json.loads(push.stdout.readline())
pushed=[]; threading.Thread(target=lambda: [pushed.append(json.loads(l)) for l in push.stdout],daemon=True).start()
SIM=S+'/sim.json'; json.dump({'percent':70,'onCharger':True,'lid':False},open(SIM,'w'))
env=dict(os.environ,POCKET_HOME=S+'/home',POCKET_APP_URL=APP)
ph.setup(R, env, 'TestMac', BOARD)
agent=subprocess.Popen(['node','agent.js'],cwd=R+'/agent',env=dict(env,POWER_SIM=R+'/agent/test/sim-mac.js',SIM_STATE=SIM,POCKET_PUSH_TEST='1',POCKET_READY_AFTER_MS='3000',POCKET_DEBUG_NOTES='1'),stdout=open(S+'/agent.log','w'),stderr=subprocess.STDOUT)
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

# The alarm clock: when the agent has frozen itself ("SLEEP") and its alarm time comes, wake it.
sleeps=[]; wakes=[]; stop=False; hold=False
notes=lambda: len(json.load(open(S+'/board.json')))
def clock():
    seen=0
    while not stop:
        try: lines=open(SIM+'.log').read().split('\n')
        except FileNotFoundError: lines=[]
        alarm=None; asleep=False
        for l in lines:
            if l.startswith('alarm '): alarm=datetime.fromisoformat(l[6:].replace('Z','+00:00')).timestamp()
            if l=='SLEEP': asleep=True
        n=lines.count('SLEEP')
        if n>seen: seen=n; sleeps.append(time.time())
        if not hold and n>len(wakes) and alarm and time.time()>=alarm and len(sleeps)==n:
            time.sleep(0.4); agent.send_signal(signal.SIGCONT); wakes.append(time.time())
        time.sleep(0.1)
threading.Thread(target=clock,daemon=True).start()

try:
  with sync_playwright() as p:
    b=p.chromium.launch(args=['--disable-features=WebRtcHideLocalIpsWithMdns'])
    ctx=b.new_context(**p.devices['iPhone 13']); pg=ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    ph.pair(pg, R, env); check(1, 'connected', wait(lambda: awake(pg), 40))
    dev=json.load(open(S+'/home/direct.json'))['devices'][0]['id']; json.dump({dev:[SUB]}, open(S+'/home/push-subs.json','w'))
    # Pick "Fast" in Power settings (wake every 20 s).
    ph.nav(pg,'power'); pg.click('#speedSeg [data-v="fast"]')
    check(2, 'the speed setting reaches the computer', wait(lambda: '"speed":"fast"' in open(S+'/home/power.json').read().replace(' ','').replace('\n',''), 10))
    ph.close_menu(pg)
    # Unplug and close the lid, close the app: it falls asleep.
    json.dump({'percent':70,'onCharger':False,'lid':True},open(SIM,'w'))
    pg.close()
    check(3, 'the computer goes to sleep', wait(lambda: len(sleeps)>=1, 60))
    # It checks in quietly (nobody knocked) and goes straight back to sleep.
    check(4, 'quiet check-ins: it wakes on its alarm and sleeps again', wait(lambda: len(wakes)>=1 and len(sleeps)>=2, 60) and 'woke up to check in' in open(S+'/agent.log').read())

    # Open the app: it counts down to the next check-in, then really connects about then.
    pg=ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); t_open=time.time(); pg.goto(APP)
    st=wait(lambda: re.search(r'wakes up in (\d+)s', pg.inner_text('#bannerText') or ''), 20)
    secs=int(st.group(1)) if st else None
    if not st: print('banner was:', pg.inner_text('#bannerTitle'), '|', pg.inner_text('#bannerText'), '| status:', pg.inner_text('#macStatus') if pg.query_selector('#macStatus') else '', pg.evaluate("localStorage.getItem('pt_debug')"))
    predicted=time.time()+secs if secs is not None else None
    check(5, 'the app says when it wakes (Fast: under 20 s)', secs is not None and secs<=20 and f'wakes in {secs}s')
    conn=wait(lambda: awake(pg), 60); t_conn=time.time()
    late = t_conn-predicted if predicted else 99
    check(6, 'it connects when the app said (within 10 s after)', conn and -3 <= late <= 10 and f'{late:+.1f}s vs the countdown')

    # The free board allows only a few hundred notes a day: while the app waits for a sleeping
    # computer, knocks are budgeted (an offer is reused while it's good, hello at most every 4 min).
    pg.close(); s0=len(sleeps); wait(lambda: len(sleeps)>s0, 60)
    hold=True; time.sleep(1); c0=notes()
    pg=ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.goto(APP); time.sleep(75)
    used=notes()-c0
    check('9b', 'waiting 75 s for a sleeping computer costs at most 3 board notes', used<=3 and f'{used} notes')
    hold=False
    check('9c', 'and it still connects at the next check-in', wait(lambda: awake(pg), 60))
    # The board's daily limit is used up: say so plainly (not "offline"), and don't hammer it.
    pg.close(); open(FULL,'w').close(); c0=notes()
    pg=ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.goto(APP)
    check('9d', 'a full board is explained, with what to do', wait(lambda: 'board is full' in pg.inner_text('#bannerTitle') and 'mobile data' in pg.inner_text('#bannerText'), 20))
    os.remove(FULL); pg.close()

    # Leave the app while it's asleep: one "is awake" notification when it connects up.
    pg.close(); n=len(pushed); s0=len(sleeps)
    check(8, 'asleep again', wait(lambda: len(sleeps)>s0, 60))
    pg=ctx.new_page(); pg.goto(APP); wait(lambda: pg.is_visible('#bannerText') and 'wakes up in' in pg.inner_text('#bannerText'), 15); time.sleep(1.5); print('knock page banner:', pg.inner_text('#bannerText')); pg.close(); print('closed at', time.strftime('%H:%M:%S', time.gmtime()))
    got=wait(lambda: [x for x in pushed[n:] if x.get('ok') and 'is awake' in json.dumps(x)], 45)
    check(9, 'left the app: "is awake ✓" arrives after its next check-in', got)
    log=open(S+'/agent.log').read()
    m=re.findall(r'phone connected ([\d.]+) s after waking', log)
    check(10, 'after waking it connects in a few seconds', m and float(m[0])<6 and m[0]+' s')
    pg=ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.goto(APP); wait(lambda: awake(pg), 60)
    pg.click('#term'); pg.keyboard.type('echo woke-$((40+2))\n')
    check(7, 'the terminal works after all that', wait(lambda: 'woke-42' in pg.evaluate("[...document.querySelectorAll('.xterm-rows > div')].map(d=>d.textContent).join('\\n')"), 10))
    check(11, 'no page errors', not errs)
    if not ok: L=open(S+'/agent.log').read()[-3000:]; print(L); ph.ci(L,'agent log')
    print('ALL OK' if ok else 'FAILED')
    b.close()
finally:
  stop=True
  try: agent.send_signal(signal.SIGCONT); agent.terminate()
  except Exception: pass
  svc.terminate(); push.kill()
