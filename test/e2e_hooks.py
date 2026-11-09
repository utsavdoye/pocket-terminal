# Agents started or running OUTSIDE the phone app, end to end:
#   - "npx pocket-terminal run …": a command started in the computer's own terminal, live on the phone too
#   - Claude Code's hook: a permission question reaches the phone (app + notification) when you're away,
#     Allow / Deny goes back to it; when you're at the computer it stays on screen; working / finished.
#   Run: python3 test/e2e_hooks.py
import subprocess, time, os, json, sys, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import pairing_helper as ph
from playwright.sync_api import sync_playwright
S=__import__('tempfile').mkdtemp(); os.makedirs(S+'/home'); os.makedirs(S+'/u/proj'); R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
svc=subprocess.Popen(['node','test/run-services.js','8890','8891',S+'/board.json'],cwd=R,stdout=subprocess.PIPE,text=True)
ports=json.loads(svc.stdout.readline()); BOARD=f"http://127.0.0.1:{ports['board']}"; APP=f"http://localhost:{ports['app']}/app/"
push=subprocess.Popen(['node','test/push-receiver.js'],cwd=R,stdout=subprocess.PIPE,text=True); SUB=json.loads(push.stdout.readline())
pushed=[]; threading.Thread(target=lambda: [pushed.append(json.loads(l)) for l in push.stdout],daemon=True).start()
env=dict(os.environ,POCKET_HOME=S+'/home',POCKET_APP_URL=APP,SHELL='/bin/bash')
ph.setup(R, env, 'TestMac', BOARD)
agent=subprocess.Popen(['node','agent.js'],cwd=R+'/agent',env=dict(env,POWER_BRAIN='0',HOME=S+'/u',POCKET_PUSH_TEST='1',POCKET_READY_AFTER_MS='4000'),stdout=open(S+'/agent.log','w'),stderr=subprocess.STDOUT)
ROWS="[...document.querySelectorAll('.xterm-rows > div')].map(d=>d.textContent).join('\\n')"
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
def hook(event, idle, **extra):
    h={'hook_event_name':event,'session_id':'sess-123','cwd':S+'/u/proj', **extra}
    return subprocess.Popen(['node','hook.js'],cwd=R+'/agent',env=dict(env,POCKET_IDLE_SECONDS=str(idle)),stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True), json.dumps(h)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(args=['--disable-features=WebRtcHideLocalIpsWithMdns'])
    ctx=b.new_context(**p.devices['iPhone 13']); pg=ctx.new_page()
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    ph.pair(pg, R, env); check(1, 'phone connected', wait(lambda: awake(pg), 40))
    dev=json.load(open(S+'/home/direct.json'))['devices'][0]['id']
    json.dump({dev:[SUB]}, open(S+'/home/push-subs.json','w'))

    # 1. "run": started on the computer, shown there AND on the phone, answered from the phone.
    mac=subprocess.Popen(['node','run.js','echo', 'started-$((2+3)); read -p "Continue? (y/n) " a; echo mac-got-$a'],cwd=R+'/agent',env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    out=[]; threading.Thread(target=lambda: [out.append(c) for c in iter(lambda: mac.stdout.read(1), '')],daemon=True).start()
    check(2, 'run: output shows in the computer window', wait(lambda: 'started-5' in ''.join(out), 10))
    ph.nav(pg,'sessions')
    card='#sessList .agent:has-text("Continue")'
    check(3, 'run: the phone dashboard shows it, waiting', wait(lambda: pg.is_visible('#sessList .agent.s-wait'), 15))
    pg.click('#sessList .agent.s-wait [data-sw]'); time.sleep(1.2)
    check(4, 'run: opening it on the phone shows the same screen', wait(lambda: 'started-5' in pg.evaluate(ROWS), 8))
    pg.click('#term'); pg.keyboard.type('y\n')
    check(5, 'run: answered on the phone, the computer window sees it', wait(lambda: 'mac-got-y' in ''.join(out), 8))
    check(6, 'run: the computer window ends when the command ends', wait(lambda: mac.poll() is not None, 10))

    # 1b. A full-screen app started in a wide computer window: the phone gets a clean redraw at
    #     its own width, not the wide screen squeezed in (that looked broken).
    wide=subprocess.Popen(['node','run.js','node',R+'/test/resize-app.js'],cwd=R+'/agent',env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    time.sleep(2); pg.goto(APP); wait(lambda: awake(pg), 40); ph.nav(pg,'sessions')
    wait(lambda: pg.is_visible('#sessList .agent:has-text("Node") [data-sw]') or len(pg.query_selector_all('#sessList [data-sw]'))>1, 10)
    btns=pg.query_selector_all('#sessList [data-sw]'); [b for b in btns if 'on screen' not in b.inner_text()][0].click(); time.sleep(2)
    rows=pg.evaluate(ROWS)
    check('6b', 'a wide full-screen app opens clean on the phone (redrawn at its width)', 'REDRAWN-' in rows and 'START-' not in rows)
    wide.kill()

    # 2. Claude Code hook, you're away (idle 10 min): the question goes to the phone.
    pg.goto(APP); wait(lambda: awake(pg), 40)
    h,inp=hook('PermissionRequest', 600, tool_name='Bash', tool_input={'command':'npm test'})
    h.stdin.write(inp); h.stdin.close()
    check(7, 'hook: the open app shows "Claude Code asks for permission"', wait(lambda: pg.is_visible('#needs') and 'asks for permission' in pg.inner_text('#needsTitle') and 'npm test' in pg.inner_text('#needsLine'), 15))
    got=wait(lambda: [x for x in pushed if x.get('ok') and 'npm test' in json.dumps(x)], 20)
    ans=got and got[-1]['msg'].get('ans')
    check(8, 'hook: the notification has Allow / Deny', bool(ans) and [a['title'] for a in ans['acts']]==['Allow','Deny'])
    pg.click('#needsBtns button.yes')
    h.wait(timeout=10); o=h.stdout.read()  # (communicate() after closing stdin crashes on Python 3.12)
    check(9, 'hook: Allow goes back to Claude Code as "allow"', '"behavior": "allow"' in o or '"behavior":"allow"' in o)
    check(10, 'hook: the question disappears from the phone', wait(lambda: not pg.is_visible('#needs'), 5))

    h,inp=hook('PermissionRequest', 600, tool_name='Write', tool_input={'file_path':S+'/u/proj/a.txt'})
    h.stdin.write(inp); h.stdin.close()
    ph.nav(pg,'sessions')
    qcard='#sessList .agent.s-wait:has-text("Write")'
    check(11, 'hook: the dashboard lists it with Allow / Deny', wait(lambda: pg.is_visible(qcard) and 'Deny' in pg.inner_text(qcard), 15))
    pg.click(qcard+' button:has-text("Deny")')
    h.wait(timeout=10); o=h.stdout.read()  # (communicate() after closing stdin crashes on Python 3.12)
    check(12, 'hook: Deny goes back as "deny"', '"deny"' in o)
    ph.close_menu(pg)

    # 3. You're at the computer (idle 2 s): nothing goes to the phone, Claude asks on screen as usual.
    n=len(pushed)
    h,inp=hook('PermissionRequest', 2, tool_name='Bash', tool_input={'command':'ls'})
    t0=time.time(); o=h.communicate(inp, timeout=10)[0]
    check(13, 'hook: at the computer it steps aside at once (no answer, no phone)', o.strip()=='' and time.time()-t0 < 5 and len(pushed)==n)

    # 3b. Claude running inside Pocket Terminal ("run claude"): the screen already shows its questions,
    #     so the hook stays out (no second notification for the same question).
    n=len(pushed)
    h=subprocess.Popen(['node','hook.js'],cwd=R+'/agent',env=dict(env,POCKET_IDLE_SECONDS='600',POCKET_TERMINAL='1'),stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    t0=time.time(); o=h.communicate(json.dumps({'hook_event_name':'PermissionRequest','session_id':'x','cwd':S+'/u/proj','tool_name':'Bash','tool_input':{'command':'ls'}}), timeout=10)[0]
    time.sleep(1.5)
    check('13b', 'hook: inside a Pocket Terminal session it stays out (no double notification)', o.strip()=='' and time.time()-t0 < 4 and len(pushed)==n)

    # 4. The question is dropped (answered on the computer / Claude moved on): the phone stops showing it.
    h,inp=hook('PermissionRequest', 600, tool_name='Bash', tool_input={'command':'rm -rf build'})
    h.stdin.write(inp); h.stdin.flush()
    wait(lambda: pg.is_visible('#needs') and 'rm -rf build' in pg.inner_text('#needsLine'), 15)
    h.kill()
    check(14, 'hook: a dropped question vanishes from the phone', wait(lambda: not pg.is_visible('#needs'), 8))

    # 5. Working / finished from the hook's other events.
    for ev in ['UserPromptSubmit','PreToolUse']:
        h,inp=hook(ev, 600, tool_name='Bash'); h.communicate(inp, timeout=10)
    ph.nav(pg,'sessions')
    check(15, 'hook: the dashboard shows Claude Code working, in its folder', wait(lambda: 'Claude Code' in pg.inner_text('#sessList') and 'Working' in pg.inner_text('#sessList') and 'proj' in pg.inner_text('#sessList'), 10))
    h,inp=hook('Stop', 600); h.communicate(inp, timeout=10)
    check(16, 'hook: Stop marks it finished', wait(lambda: 'Finished' in pg.inner_text('#sessList'), 10))
    # 6. You opened the app, then switched away before it connected (the computer was waking):
    #    once it's up, the phone gets one "it's awake, tap to connect" notification.
    import signal
    pg.close(); time.sleep(2); n=len(pushed)
    agent.send_signal(signal.SIGSTOP)  # the computer "sleeps"
    q=ctx.new_page(); q.goto(APP); time.sleep(7); q.close()  # opened the app, saw "asleep", went elsewhere
    time.sleep(6); agent.send_signal(signal.SIGCONT)  # it wakes and finds the phone's knock
    got=wait(lambda: [x for x in pushed[n:] if x.get('ok') and 'is awake' in json.dumps(x)], 20)
    check('16b', 'left the app before it connected: one "is awake, tap to connect" notification', bool(got) and len(got)==1)
    pg=ctx.new_page(); pg.goto(APP); wait(lambda: awake(pg), 30); time.sleep(6)
    check('16c', 'opening the app and connecting: no "awake" notification', len([x for x in pushed[n:] if 'is awake' in json.dumps(x)])==1)
    log=open(S+'/agent.log').read()
    check(17, 'never logs what the agent asked', 'npm test' not in log and 'rm -rf' not in log)
    check(18, 'no page errors', not errs)
    if not ok: L=open(S+'/agent.log').read()[-2500:]; print(L); ph.ci(L, 'agent log')
    print('ALL OK' if ok else 'FAILED')
finally:
    agent.kill(); svc.kill(); push.kill()
