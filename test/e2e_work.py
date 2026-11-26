# Working with agents from the phone, end to end (phone app in a headless browser ⇄ real agents):
#   every agent on every computer (answer one on the other computer, through the board), a race
#   between two agents in their own copies (keep the winner: merged), the task queue, changes →
#   recipes (saved, used, added from a link), a schedule with its log, the morning summary, GitHub
#   issues (a pretend gh), commit (and push without a remote says so), "tell me when it says …", the terminal holder
#   (a terminal survives a restart of the agent), and the Terminal look's colors.
#   Run: python3 test/e2e_work.py
import subprocess, time, os, json, sys, signal
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import pairing_helper as ph
from playwright.sync_api import sync_playwright
S=__import__('tempfile').mkdtemp(); R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAKE=R+'/agent/test/fixtures/fake-agent.js'
svc=subprocess.Popen(['node','test/run-services.js','8910','8911',S+'/board.json'],cwd=R,stdout=subprocess.PIPE,text=True)
ports=json.loads(svc.stdout.readline()); BOARD=f"http://127.0.0.1:{ports['board']}"; APP=f"http://localhost:{ports['app']}/app/"
agents={}; envs={}
FAST=dict(POCKET_TASK_IDLE_MS='1500',POCKET_WORK_QUIET_MS='1000',POCKET_SUMMARY_GAP_MS='1500',GIT_AUTHOR_NAME='T',GIT_AUTHOR_EMAIL='t@t',GIT_COMMITTER_NAME='T',GIT_COMMITTER_EMAIL='t@t')
def start(name):
    h=S+'/'+name
    agents[name]=subprocess.Popen(['node','agent.js'],cwd=R+'/agent',env=dict(envs[name],POWER_BRAIN='0',HOME=h+'/u',**FAST),stdout=open(h+'/agent.log','a'),stderr=subprocess.STDOUT)
# a pretend "gh" for the Laptop: one open issue of yours with the label
GH=S+'/gh.js'; open(GH,'w').write('#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify([{number:3,title:"Pear tree",body:"Plant a pear."}]));\n'); os.chmod(GH,0o755)
for name in ['Desktop','Laptop']:
    h=S+'/'+name; os.makedirs(h+'/home'); os.makedirs(h+'/u')
    # the Laptop keeps its terminals in the terminal holder (survives agent restarts); the Desktop runs them itself
    env=dict(os.environ,POCKET_HOLDER='1' if name=='Laptop' else '0',POCKET_HOME=h+'/home',POCKET_APP_URL=APP,SHELL='/bin/bash',POCKET_GH=GH); envs[name]=env
    ph.setup(R, env, name, BOARD); start(name)
REPO=S+'/Laptop/u/repo'; os.makedirs(REPO); open(REPO+'/tracked.txt','w').write('one\n')
for c in (['init','-q','-b','main'],['add','.'],['-c','user.email=t@t','-c','user.name=t','commit','-qm','first']): subprocess.run(['git','-C',REPO]+c,check=True)
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
    PROMPT=['']  # what to type into the next "prompt" box
    pg.on('dialog', lambda d: d.accept(PROMPT[0]) if d.type=='prompt' else d.accept())
    ph.pair(pg, R, envs['Desktop']); check(1, 'paired with the Desktop', wait(lambda: awake(pg) and 'Desktop' in pg.inner_text('#macName'), 40))
    pp, link = ph.start_invite(R, envs['Laptop'])
    pg.goto('about:blank'); ph.open_link(pg, link)
    wait(lambda: pg.is_visible('#replaceNote'), 8); pg.click('#replaceYes'); pg.wait_for_selector('#joinBox:not([hidden])')
    ph.read_until(pp, 'Its code:'); pp.stdin.write('y\n'); pp.stdin.flush()
    pg.wait_for_selector('#pairPad:not([hidden])', timeout=20000)
    for _ in range(2): pg.keyboard.type('654321'); pg.keyboard.press('Enter')
    pp.stdout.read(); pp.wait(5)
    check(2, 'and the Laptop (now on screen)', wait(lambda: awake(pg) and 'Laptop' in pg.inner_text('#macName'), 40))

    # ---- 1. every agent on every computer: answer the Desktop's question from the Laptop's page ----
    dk=subprocess.Popen(['node','run.js','echo','desk-$((1+1)); read -p "Ship it? (y/n) " a; echo desk-got-$a'],cwd=R+'/agent',env=dict(envs['Desktop'],**FAST),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    out=[]; __import__('threading').Thread(target=lambda: [out.append(c) for c in iter(lambda: dk.stdout.read(1), '')],daemon=True).start()
    wait(lambda: 'desk-2' in ''.join(out), 10)
    ph.nav(pg,'sessions')
    check(3, 'the Desktop shows under other computers, its agent blocked with its question', wait(lambda: 'desktop' in pg.inner_text('#others').lower() and 'Ship it' in pg.inner_text('#others'), 30))
    check(4, 'and it counts on the Agents button', wait(lambda: pg.inner_text('#dockBadge').strip() not in ('', '0'), 5))
    pg.click('#others [data-a=yes]')
    check(5, 'answered from here, through the board: the Desktop got "y"', wait(lambda: 'desk-got-y' in ''.join(out), 20))

    # ---- 2. a race: two agents, each in its own copy; keep one ----
    ph.nav(pg,'work'); pg.wait_for_selector('#pane-work.on')
    pg.click('#wAgents'); pg.fill('#wAgentsText', f'fake = node {FAKE} {{q}}\nonce = node {FAKE} --once {{q}}'); pg.click('#wAgentsForm button.btn:not(.ghost)')
    pg.click('#workSeg [data-v=race]')
    check(6, 'agent commands saved on the computer', wait(lambda: 'data-a="fake"' in pg.inner_html('#wRace'), 8))
    while pg.locator('#wRace .pick.on').count(): pg.locator('#wRace .pick.on').first.click()  # the list redraws on each tap
    pg.click('#wRace [data-a=fake]'); pg.click('#wRace [data-a=once]')
    pg.fill('#wFolder', '~/repo'); pg.fill('#wText', 'apple pie'); pg.fill('#wTest', 'test -f apple.txt')
    pg.click('#wGo')
    check(7, 'the race starts with two lanes', wait(lambda: len(pg.query_selector_all('#workList .wgroup .lane'))==2, 15))
    check(8, 'both finish, tests run, ready to pick', wait(lambda: 'pick the winner' in pg.inner_text('#workList').lower() and pg.inner_text('#workList').lower().count('tests ✓')==2, 40))
    check(9, 'each lane shows its changes (1 file)', pg.inner_text('#workList').count('1 file')==2)
    check(10, 'the project itself is untouched so far', not os.path.exists(REPO+'/apple.txt'))
    pg.evaluate("window.__lane = document.querySelector('#workList .lane')"); time.sleep(4)  # the list refreshes every 3 s
    check('10b', 'the list stays still while it refreshes (no redraw, no flicker)', pg.evaluate("window.__lane.isConnected"))
    open(REPO+'/tracked.txt','a').write('my own unsaved line\n')  # you were editing the project meanwhile
    dialogs=[]; pg.on('dialog', lambda d: dialogs.append(d.message))
    pg.click('#workList .lane:has-text("once") [data-keep]')
    check(11, 'keep one (with your own unsaved changes): merged, your changes still there, the copies gone', wait(lambda: os.path.exists(REPO+'/apple.txt'), 20)
          and 'my own unsaved line' in open(REPO+'/tracked.txt').read()
          and subprocess.run(['git','-C',REPO,'branch','--list','pt/*'],capture_output=True,text=True).stdout.strip()=='')
    check('11b', 'the race leaves the list', wait(lambda: not pg.query_selector('#workList .wgroup'), 10))
    check('11c', 'it offers to push the project itself (here: no remote, so it says so)', wait(lambda: pg.wait_for_timeout(200) or any('Push your project' in d for d in dialogs) and any('no remote' in d.lower() for d in dialogs), 15))
    subprocess.run(['git','-C',REPO,'checkout','--','tracked.txt'],check=True)

    # ---- 3. the queue ----
    pg.click('#workSeg [data-v=queue]'); pg.select_option('#wAgent', '__cmd')
    pg.fill('#wFolder', '~/repo'); pg.fill('#wText', 'echo queued > q.txt'); pg.click('#wGo')
    check(12, 'a queued command runs and shows done', wait(lambda: os.path.exists(REPO+'/q.txt') and 'done' in pg.inner_text('#workList .wtask').lower(), 20))

    # ---- 3b. recipes: save this way of working, use it, add one from a link ----
    pg.click('#workSeg [data-v=chain]'); pg.fill('#wTest', 'true'); PROMPT[0]='Write then check'
    pg.click('#wSaveRecipe')
    check('12a', 'a recipe is saved from the form', wait(lambda: pg.wait_for_timeout(200) or 'Write then check' in pg.inner_text('#wRecipes'), 10))
    pg.click('#workSeg [data-v=queue]'); pg.evaluate("document.getElementById('wTest').value = ''")
    pg.click('#wRecipes [data-r]'); pg.click('#wRecipes .pick.on')
    check('12b', 'one tap puts it back in the form', wait(lambda: 'on' in pg.get_attribute('#workSeg [data-v=chain]','class') and pg.input_value('#wTest')=='true', 8))
    link=pg.evaluate("location.origin + location.pathname + '#recipe=' + btoa(JSON.stringify({ n: 'Shared one', w: { kind: 'race', agents: ['fake', 'once'], test: 'echo shared' } })).replace(/=+$/, '')")
    PROMPT[0]=link; pg.click('#wRecipes [data-paste]')
    check('12c', 'a recipe from a link: you see every command in it before it is added', wait(lambda: pg.wait_for_timeout(200) or ('Shared one' in pg.inner_text('#wRecipes') and any('echo shared' in d and 'Add the recipe' in d for d in dialogs)), 10))
    # ---- 3c. a schedule: saved from the form, run now, its log ----
    pg.click('#workSeg [data-v=queue]'); pg.select_option('#wAgent', '__cmd'); pg.fill('#wFolder', '~/repo'); pg.fill('#wText', 'echo sched > s.txt')
    pg.click('#wSchedOpen'); pg.fill('#wSchedAt', '03:00'); pg.fill('#wSchedName', 'Night'); pg.click('#wSchedSave')
    check('12d', 'a schedule is saved (time, every day)', wait(lambda: 'Night' in pg.inner_text('#schedList') and '03:00' in pg.inner_text('#schedList') and 'every day' in pg.inner_text('#schedList'), 10))
    pg.click('#schedList [data-srun]')
    check('12e', '"Run now" runs it', wait(lambda: os.path.exists(REPO+'/s.txt'), 20))
    pg.click('#schedList [data-slog]')
    check('12f', 'and its log shows the run', wait(lambda: pg.wait_for_timeout(500) or ('done' in pg.inner_text('#schedList .plog') and 'started' in pg.inner_text('#schedList .plog')), 20))
    # ---- 3d. the morning summary, GitHub issues ----
    pg.check('#mornOn')
    check('12g', 'morning summary turned on (saved on the computer)', wait(lambda: json.load(open(S+'/Laptop/home/plans.json'))['morning']['on'], 8))
    pg.click('#ghAdd'); pg.fill('#ghFolder', '~/repo'); pg.click('#ghForm button.btn:not(.ghost)')
    check('12h', 'GitHub: the project is saved and its labelled issue starts a race', wait(lambda: 'label' in pg.inner_text('#ghList') and 'Fix GitHub issue #3: Pear tree' in pg.inner_text('#workList'), 30))
    check('12i', 'and the project says what it started', wait(lambda: 'Started on #3' in pg.inner_text('#ghList'), 15))
    pg.click('#workList .wgroup [data-cancel]')
    check('12j', 'that race can be stopped like any other', wait(lambda: not pg.query_selector('#workList .wgroup'), 15))

    # ---- 4. changes → commit; push without a remote says so ----
    ph.close_menu(pg); typ(pg, f'cd ~/repo && echo two >> tracked.txt\n'); time.sleep(1)
    ph.nav(pg,'sessions')
    check(13, 'the terminal shows its branch', wait(lambda: 'main' in pg.inner_text('#sessList .agent.cur'), 20))
    pg.click('#sessList .agent.cur [data-diff]')
    check(14, 'changes: the diff and the commit bar', wait(lambda: '+two' in pg.inner_text('#diffOut') and pg.is_visible('#gitBar'), 10))
    pg.fill('#gitMsg', 'Add two from the phone'); pg.click('#gitCommit')
    check(15, 'commit from the phone', wait(lambda: 'Add two from the phone' in subprocess.run(['git','-C',REPO,'log','-1','--format=%s'],capture_output=True,text=True).stdout, 10))
    pg.click('#gitPush')
    check(16, 'push without a remote explains it', wait(lambda: 'no remote' in pg.inner_text('#gitNote').lower(), 15))

    # ---- 4b. review: a note on a changed line goes to the agent's box (not sent for you) ----
    ph.close_menu(pg); typ(pg, 'echo three >> tracked.txt\n'); time.sleep(1)
    ph.nav(pg,'sessions'); pg.click('#sessList .agent.cur [data-diff]')
    wait(lambda: '+three' in pg.inner_text('#diffOut'), 10)
    pg.click('#diffOut .l.a:has-text("+three")')
    check('16a', 'tap a changed line: a note box for that file and line', wait(lambda: pg.is_visible('#rvForm') and 'tracked.txt line 3' in pg.get_attribute('#rvIn','placeholder'), 5))
    pg.fill('#rvIn', 'call it four instead'); pg.click('#rvForm button')
    check('16b', 'the note is listed and the line is marked', wait(lambda: 'call it four instead' in pg.inner_text('#rvNotes') and pg.locator('#diffOut .l.noted').count()==1 and 'Send 1 note' in pg.inner_text('#rvSend'), 5))
    pg.click('#rvSend')
    check('16c', 'sent: it is typed into the terminal as one line, with the file, line and note', wait(lambda: 'Review notes on your changes. (1) tracked.txt line 3 [three]: call it four instead' in pg.evaluate(ROWS).replace('\n',''), 10))
    time.sleep(0.5)
    check('16d', 'but not run: you press Enter yourself', 'command not found' not in pg.evaluate(ROWS))
    pg.click('#term'); pg.keyboard.press('Control+c'); time.sleep(0.5)

    # ---- 5. tell me when it says … ----
    ph.nav(pg,'sessions'); pg.click('#sessList .agent.cur [data-watch]')
    pg.fill('#sessList [data-wform] input', 'magic-word-42'); pg.click('#sessList [data-wform] button')
    check(17, 'the watch shows on the card', wait(lambda: 'magic-word-42' in pg.inner_text('#sessList'), 8))
    ph.close_menu(pg); typ(pg, 'echo magic-word-$((40+2))\n')
    check(18, 'it fires when the terminal says it (a toast here, a notification when away)', wait(lambda: 'magic-word-42' in pg.inner_text('#toast'), 10))

    # ---- 6. the terminal holder: a restart of the agent keeps the terminal ----
    typ(pg, 'export KEPT=still-$((6*7))\n'); time.sleep(0.8)
    agents['Laptop'].send_signal(signal.SIGTERM); agents['Laptop'].wait(10); time.sleep(1)
    start('Laptop')
    pg.goto(APP); wait(lambda: awake(pg), 40); time.sleep(1.5)
    typ(pg, 'echo got-$KEPT\n')
    check(19, 'after a restart of the agent the same shell is back (its variable kept)', wait(lambda: 'got-still-42' in pg.evaluate(ROWS), 15))

    # ---- 7. the look ----
    ph.nav(pg,'settings'); pg.click('#themeSeg [data-v=tech]'); pg.select_option('#paletteSel', 'nord')
    check(20, 'Terminal look with the Nord colors', pg.evaluate("[document.documentElement.dataset.style, document.documentElement.dataset.palette]")==['tech','nord'])
    check(21, 'no page errors', not errs)
    if not ok or errs:
        print(errs)
        for name in agents: print(name, open(S+'/'+name+'/agent.log').read()[-2500:])
    print('ALL OK' if ok else 'FAILED')
finally:
    for a in agents.values(): a.kill()
    try: os.kill(int(open(S+'/Laptop/home/holder.pid').read()), signal.SIGTERM)
    except Exception: pass
    svc.kill()
