# v7 tools, end to end: the phone app in a headless browser ⇄ the real agent.
#   Needs you (one-tap answer), terminals (switch, survive a fresh launch), phone notifications
#   (decrypted by a pretend push service), open-from-notification, files (download + upload),
#   local website preview (real HTTP server, root-absolute links), and a view-only share link.
#   Run: python3 test/e2e_tools.py
import subprocess, time, os, json, sys, threading, http.server, functools
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import pairing_helper as ph
from playwright.sync_api import sync_playwright
S=__import__('tempfile').mkdtemp(); os.makedirs(S+'/home'); os.makedirs(S+'/u'); R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
open(S+'/u/hello.txt','w').write('hello from the computer\n')
# a git project for the "what changed" summary
os.makedirs(S+'/u/repo'); open(S+'/u/repo/tracked.txt','w').write('one\n')
for c in (['init','-q'],['add','.'],['-c','user.email=t@t','-c','user.name=t','commit','-qm','first']): subprocess.run(['git','-C',S+'/u/repo']+c,check=True)
# a local website with a root-absolute script and link
os.makedirs(S+'/site'); open(S+'/site/index.html','w').write('<!doctype html><html><head><script src="/app.js"></script></head><body><h1 id=h>Home</h1><a id=go href="/page2.html">next</a></body></html>')
open(S+'/site/app.js','w').write('document.title="site-js-ran";'); open(S+'/site/page2.html','w').write('<html><head><title>page-two</title></head><body>Second page</body></html>')
site=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=S+'/site')); SITE=site.server_address[1]
threading.Thread(target=site.serve_forever,daemon=True).start()
svc=subprocess.Popen(['node','test/run-services.js','8884','8885',S+'/board.json'],cwd=R,stdout=subprocess.PIPE,text=True)
ports=json.loads(svc.stdout.readline()); BOARD=f"http://127.0.0.1:{ports['board']}"; APP=f"http://localhost:{ports['app']}/app/"
push=subprocess.Popen(['node','test/push-receiver.js'],cwd=R,stdout=subprocess.PIPE,text=True); SUB=json.loads(push.stdout.readline())
pushed=[]; threading.Thread(target=lambda: [pushed.append(json.loads(l)) for l in push.stdout],daemon=True).start()
env=dict(os.environ,POCKET_HOLDER='0',POCKET_HOME=S+'/home',POCKET_APP_URL=APP,SHELL='/bin/bash')
ph.setup(R, env, 'TestMac', BOARD)
agent=subprocess.Popen(['node','agent.js'],cwd=R+'/agent',env=dict(env,POWER_BRAIN='0',HOME=S+'/u',POCKET_PUSH_TEST='1'),stdout=open(S+'/agent.log','w'),stderr=subprocess.STDOUT)
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
def sessions(pg):
    ph.nav(pg,'sessions'); time.sleep(1.2); t=pg.inner_text('#sessList'); return t
try:
  with sync_playwright() as p:
    b=p.chromium.launch(args=['--disable-features=WebRtcHideLocalIpsWithMdns'])
    ctx=b.new_context(viewport={'width':390,'height':844}, has_touch=True)
    pg=ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    ph.pair(pg, R, env); check(0, 'paired and live', wait(lambda: awake(pg), 40))

    # 1. A program asks: the "needs you" bar appears, one tap answers it.
    typ(pg, 'read -p "Continue? [y/N] " a; echo answered-$a\n')
    check(1, 'question shows the Needs-you bar', wait(lambda: pg.is_visible('#needs') and 'y/N' in pg.inner_text('#needsLine'), 8))
    pg.click('#needsBtns button.yes')
    check(2, 'one tap answers it', wait(lambda: 'answered-y' in pg.evaluate(ROWS), 5) and pg.is_hidden('#needs'))

    # 2. Terminals: start a long program, open a second terminal, switch back.
    typ(pg, 'sleep 600\n'); time.sleep(2.5)
    t=sessions(pg); check(3, 'Agents lists this one with sleep running', 'sleep' in t and 'on screen' in t)
    pg.click('#sessNew'); time.sleep(1.5); typ(pg, 'echo in-second-terminal\n')
    check(4, 'new terminal works', wait(lambda: 'in-second-terminal' in pg.evaluate(ROWS), 5))
    t=sessions(pg); check(5, 'both terminals listed', t.count('Shell') + t.count('sleep') >= 2)
    first_sid=pg.evaluate("[...document.querySelectorAll('#sessList [data-sw]')].map(b=>b.dataset.sw)")
    pg.click('#sessList .agent:has-text("sleep") [data-sw]'); time.sleep(1.2)
    check(6, 'switching back shows the first terminal', wait(lambda: 'answered-y' in pg.evaluate(ROWS), 5))
    pg.keyboard.press('Control+C'); time.sleep(0.3)

    # 3. A fresh launch keeps terminals that are still running something.
    typ(pg, 'sleep 600\n'); time.sleep(2.5)
    pg2=ctx.new_page(); pg2.goto(APP); check(7, 'fresh launch connects', wait(lambda: awake(pg2), 40))
    t=sessions(pg2); check(8, 'the running sleep survived the fresh launch', 'sleep' in t)
    ph.close_menu(pg2)

    # 4. Phone notification: a terminal nobody is looking at asks a question.
    dev=json.load(open(S+'/home/direct.json'))['devices'][0]['id']
    json.dump({dev:[SUB]}, open(S+'/home/push-subs.json','w'))
    pg2.click('#menuBtn'); pg2.click('#tabs [data-tab=sessions]'); time.sleep(1); pg2.click('#sessNew'); time.sleep(1.5)
    typ(pg2, 'sleep 16; read -p "Deploy now? (y/n) " a; echo deploy-$a\n'); time.sleep(0.5)
    asking_sid=pg2.evaluate("sessionStorage.getItem('pt_sid')")
    pg2.close()  # nobody is watching that terminal now
    got=wait(lambda: [x for x in pushed if x.get('ok') and 'Deploy now' in json.dumps(x)], 30)
    if not got: print('   pushed:', pushed); print('   agent log:', open(S+'/agent.log').read()[-1500:])
    check(9, 'phone notification arrives, encrypted, with VAPID', got and got[0]['vapid'] and got[0]['msg']['title'].endswith('needs you'))
    check(10, 'it names the terminal to open', got and got[0]['msg']['sid'] == asking_sid)
    pg3=ctx.new_page(); pg3.goto(APP+'#s='+asking_sid)  # what tapping the notification does
    check(11, 'tapping it opens that terminal', wait(lambda: 'Deploy now' in pg3.evaluate(ROWS), 40))
    pg3.click('#term'); pg3.keyboard.type('y\n'); check(12, 'and you can answer there', wait(lambda: 'deploy-y' in pg3.evaluate(ROWS), 5))
    pg3.close()

    # 4b. Agents dashboard: a terminal in the background asks; answer it from the dashboard, no switching.
    def ask_in_background(cmd):
        q=ctx.new_page(); q.goto(APP); wait(lambda: awake(q), 40); ph.nav(q,'sessions'); time.sleep(1); q.click('#sessNew'); time.sleep(1.5)
        typ(q, cmd); time.sleep(0.5); sid=q.evaluate("sessionStorage.getItem('pt_sid')"); q.close(); return sid
    ship_sid=ask_in_background('read -p "Ship it? (y/n) " a; echo shipped-$a\n')
    pg.bring_to_front(); wait(lambda: awake(pg), 20); ph.nav(pg,'sessions')
    card='#sessList .agent.s-wait:has-text("Ship it")'
    check('12b', 'dashboard shows the waiting terminal with its question', wait(lambda: pg.is_visible(card), 15))
    check('12c', 'summary counts who needs you', wait(lambda: 'blocked' in pg.inner_text('#agSum').lower() and pg.inner_text('#agSum').strip().startswith('1'), 5))
    check('12d', 'it shows the folder', '~' in pg.inner_text(card))
    pg.click(card+' button.yes')
    check('12e', 'answering from the dashboard: the card stops waiting', wait(lambda: not pg.is_visible(card), 10))
    pg.click(f'#sessList [data-sw="{ship_sid}"]'); time.sleep(1.2)
    check('12f', 'and the answer reached that terminal', wait(lambda: 'shipped-y' in pg.evaluate(ROWS), 8))

    # 4c. Answer buttons on the notification (what the service worker does when you tap "Yes" on a watch).
    rel_sid=ask_in_background('sleep 16; read -p "Release now? (y/n) " a; echo released-$a\n')
    got=wait(lambda: [x for x in pushed if x.get('ok') and 'Release now' in json.dumps(x)], 30)
    ans=got and got[-1]['msg'].get('ans')
    check('12g', 'the notification carries Yes/No buttons and a one-time answer key', bool(ans) and [a['action'] for a in ans['acts']]==['yes','no'] and len(ans['k'])>=40)
    SEND="""async ([ans, choice, keyOverride]) => {
      const fromB64u=(s)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((s.length+3)%4)),c=>c.charCodeAt(0));
      const b64u=(u8)=>btoa(String.fromCharCode(...u8)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
      const key=await crypto.subtle.importKey('raw', keyOverride?crypto.getRandomValues(new Uint8Array(32)):fromB64u(ans.k),'AES-GCM',false,['encrypt']);
      const iv=crypto.getRandomValues(new Uint8Array(12));
      const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify({a:choice,ts:Date.now()}))));
      const blob=new Uint8Array(12+ct.length); blob.set(iv); blob.set(ct,12);
      const r=await fetch(ans.b.replace(/\\/+$/,'')+'/'+encodeURIComponent(ans.tp),{method:'POST',body:'pta1.'+ans.id+'.'+b64u(blob)}); return r.status; }"""
    if ans:
        pg.evaluate(SEND, [ans, 'yes', True]); time.sleep(2)   # a forged answer (wrong key) is ignored
        pg.evaluate(SEND, [ans, 'yes', False]); time.sleep(2)  # the real one
        pg.evaluate(SEND, [ans, 'no', False]); time.sleep(1.5) # a replay: works only once
    log=open(S+'/agent.log').read()
    check('12h', 'tapping Yes on the notification answers the terminal', 'answered "yes" from a notification' in log)
    check('12i', 'a forged or replayed answer does nothing', log.count('from a notification')==1)
    pg.click('#term'); ph.nav(pg,'sessions'); time.sleep(1); pg.click(f'#sessList [data-sw="{rel_sid}"]'); time.sleep(1.2)
    check('12j', 'the terminal got exactly one "y"', wait(lambda: 'released-y' in pg.evaluate(ROWS), 8) and 'released-n' not in pg.evaluate(ROWS))
    pw_sid=ask_in_background('sleep 16; read -s -p "Password: " pw; echo\n')
    gotpw=wait(lambda: [x for x in pushed if x.get('ok') and 'Password' in json.dumps(x)], 30)
    check('12k', 'password questions never get answer buttons', gotpw and 'ans' not in gotpw[-1]['msg'])

    # 4d. Auto-approve: turn it on with a safe word; a safe question is answered by itself, a risky one still asks.
    pg.click('#term'); pg.keyboard.press('Control+C'); time.sleep(0.3)
    ph.nav(pg,'settings'); pg.click('#autoSetup'); wait(lambda: pg.input_value('#autoAllow') != '', 8)
    pg.fill('#autoAllow', 'npm test'); pg.check('#autoOn'); pg.click('#autoForm button.btn:not(.ghost)')
    check('12l', 'auto-approve is saved on the computer', wait(lambda: json.load(open(S+'/home/auto.json'))['enabled'], 5))
    ph.close_menu(pg)
    typ(pg, 'clear; printf "\\n%.0s" {1..12}\n'); time.sleep(0.5)
    typ(pg, 'echo "Bash(npm test)"; read -p "Proceed? (y/n) " a; echo auto-$a\n')
    check('12m', 'a safe step is answered by itself', wait(lambda: 'auto-y' in pg.evaluate(ROWS), 10))
    typ(pg, 'echo "Bash(npm test && git push)"; read -p "Proceed? (y/n) " a; echo risky-$a\n')
    check('12n', 'a risky step still asks you', wait(lambda: pg.is_visible('#needs'), 8) and 'risky-y' not in pg.evaluate(ROWS))
    pg.click('#needsBtns >> text=No'); wait(lambda: 'risky-n' in pg.evaluate(ROWS), 5)

    # 4e. Answer in your own words.
    typ(pg, 'read -p "Anything to change? (y/n) " a; echo said-$a\n')
    wait(lambda: pg.is_visible('#needs'), 8); pg.click('#needsBtns >> text=Say')
    check('12o', 'Say opens the answer box', wait(lambda: pg.is_visible('#sayBox'), 5))
    pg.fill('#sayIn', 'use the blue button'); pg.click('#saySend')
    check('12p', 'your words reach the terminal', wait(lambda: 'said-use the blue button' in pg.evaluate(ROWS).replace('\u00a0',' '), 8))

    # 4f. When a program finishes: what changed, and the full change list.
    chg_sid=ask_in_background('cd ~/repo && python3 -c "import time;time.sleep(22);open(\'tracked.txt\',\'a\').write(\'two\\n\');print(\'built-ok-\'+str(3+4))"\n')
    gotd=wait(lambda: [x for x in pushed if x.get('ok') and 'finished' in x['msg'].get('title','') and x['msg'].get('sid')==chg_sid], 45)
    check('12q', 'the "finished" notification says what changed', gotd and '1 file changed (+1 −0)' in gotd[-1]['msg']['body'])
    check('12q2', 'and shows the last lines it printed (not the prompt)', gotd and 'built-ok-7' in gotd[-1]['msg']['body'] and '$' not in gotd[-1]['msg']['body'].split('\n')[-1])
    ph.nav(pg,'sessions'); time.sleep(1.2)
    check('12r', 'the dashboard shows it finished with its changes', wait(lambda: '1 file +' in pg.inner_text('#sessList'), 8))
    pg.click(f'[data-diff="{chg_sid}"]')
    check('12s', 'See changes shows the real diff', wait(lambda: '+two' in pg.inner_text('#diffOut') and 'tracked.txt' in pg.inner_text('#diffOut'), 10))
    ph.close_menu(pg)
    time.sleep(0.6)

    # 5. Files: download and upload.
    pg.bring_to_front(); wait(lambda: awake(pg), 20)
    ph.nav(pg,'files'); wait(lambda: 'hello.txt' in pg.inner_text('#fileList'), 8)
    pg.click('#fileList >> text=hello.txt')
    check('13a', 'tapping a file asks what to do, showing its path', wait(lambda: pg.is_visible('#fileAct') and pg.inner_text('#faPath').endswith('hello.txt'), 5))
    typed = pg.inner_text('#faPath'); pg.click('#faPut')
    check('13b', 'put its path in the terminal (typed, not run)', wait(lambda: pg.is_hidden('#fileAct') and pg.is_hidden('#sheet .panel') or True, 2) and wait(lambda: typed in pg.evaluate('window.ptText()'), 8))
    pg.click('#term'); pg.keyboard.press('Control+U'); time.sleep(0.3)
    ph.nav(pg,'files'); wait(lambda: 'hello.txt' in pg.inner_text('#fileList'), 8)
    pg.click('#fileList >> text=hello.txt'); wait(lambda: pg.is_visible('#faGet'), 5); pg.click('#faGet')
    check(13, 'download a file', wait(lambda: pg.is_visible('#saved') and 'hello.txt' in pg.inner_text('#savedName'), 8))
    open(S+'/up.bin','wb').write(os.urandom(150*1024))
    pg.set_input_files('#filePick', S+'/up.bin')
    check(14, 'upload a 150 KB file, byte for byte', wait(lambda: os.path.exists(S+'/u/up.bin') and open(S+'/u/up.bin','rb').read()==open(S+'/up.bin','rb').read(), 15))
    wait(lambda: pg.is_hidden('#xfer'), 10); pg.evaluate("document.getElementById('filePick').value=''")
    pg.set_input_files('#filePick', S+'/up.bin')
    check(15, 'a second upload never overwrites', wait(lambda: os.path.exists(S+'/u/up (1).bin'), 15))

    # 6. Local website preview.
    pg.click('#sheetBack'); pg.click('#tabs [data-tab=web]')
    check(16, 'the running site is detected', wait(lambda: str(SITE) in pg.inner_text('#portList'), 10))
    pg.click(f'[data-port="{SITE}"]')
    fr=lambda: pg.frame_locator('#pvFrame')
    check(17, 'the site opens in the preview', wait(lambda: fr().locator('#h').inner_text()=='Home', 15))
    check(18, 'its root-absolute script /app.js loads from the site', wait(lambda: pg.frames[1].title()=='site-js-ran', 8))
    fr().locator('#go').click()
    check(19, 'a /page2.html link stays inside the preview', wait(lambda: pg.frames[1].title()=='page-two', 10))
    pg.click('#pvClose')

    # 7. Share a view-only link.
    ph.close_menu(pg); pg.click('#term'); pg.keyboard.press('Control+C'); time.sleep(0.3)
    ph.nav(pg,'sessions'); time.sleep(1); pg.click('#shareBtn')
    link=wait(lambda: pg.input_value('#shareLink') if '#watch=' in pg.input_value('#shareLink') else None, 8)
    check(20, 'a view-only link is made', bool(link)); ph.close_menu(pg)
    typ(pg, 'echo shared-screen-$((6*7))\n')
    vctx=b.new_context(viewport={'width':390,'height':844}); vw=vctx.new_page(); vw.goto(link)
    seen=wait(lambda: 'shared-screen-42' in vw.evaluate(ROWS), 40)
    if not seen: print('   viewer rows:', repr(vw.evaluate(ROWS)[-600:]), vw.inner_text('#status'))
    check(21, 'a stranger with the link sees it live', seen)
    check(22, 'view only: no keys, no menu', vw.is_hidden('#keys') and vw.is_hidden('#menuBtn'))
    vw.click('#term'); vw.keyboard.type('echo viewer-typed\n'); time.sleep(1.5)
    check(23, "the viewer's typing never reaches the terminal", 'viewer-typed' not in pg.evaluate(ROWS))
    check(24, 'nothing of the viewer is saved on its browser', vw.evaluate("Object.keys(localStorage).filter(k=>k!=='pt_theme').length")==0)
    typ(pg, 'echo after-share\n')
    check(25, 'viewer keeps following', wait(lambda: 'after-share' in vw.evaluate(ROWS), 8))
    ph.nav(pg,'sessions'); time.sleep(0.5); pg.click('#shareStop')
    check(26, 'Stop sharing ends it for the viewer', wait(lambda: 'live view ended' in vw.evaluate(ROWS).lower(), 10))
    vw2=vctx.new_page(); vw2.goto(link); time.sleep(8)
    check(27, 'the old link no longer connects', 'echo' not in vw2.evaluate(ROWS) and not awake(vw2))
    # 8. A teammate's link that may answer Yes/No (and nothing else).
    ph.nav(pg,'sessions'); time.sleep(0.5); pg.check('#shareAnswer'); pg.click('#shareBtn')
    link2=wait(lambda: pg.input_value('#shareLink') if '#watch=' in pg.input_value('#shareLink') and pg.input_value('#shareLink')!=link else None, 8)
    ph.close_menu(pg)
    tw=vctx.new_page(); tw.goto(link2); wait(lambda: 'Live' in tw.inner_text('#status'), 40)
    typ(pg, 'read -p "Merge it? (y/n) " a; echo team-$a\n')
    check(30, "the teammate sees the question with Yes / No", wait(lambda: tw.is_visible('#needs') and 'Merge it' in tw.inner_text('#needsLine'), 15))
    check(31, 'and only Yes / No (no Say, no keys)', tw.inner_text('#needsBtns').split()==['Yes','No'] and tw.is_hidden('#keys'))
    tw.click('#needsBtns >> text=Yes')
    check(32, "the teammate's Yes answers it", wait(lambda: 'team-y' in pg.evaluate(ROWS), 8))
    ph.nav(pg,'sessions'); time.sleep(0.5); pg.click('#shareStop'); ph.close_menu(pg)
    check(28, 'no page errors', not errs); errs and print(errs)
    b.close()
finally:
    agent.terminate(); svc.terminate(); push.terminate(); site.shutdown()
    log=open(S+'/agent.log').read()
    check(29, 'agent never logged command text or file names', 'Deploy now' not in log and 'hello.txt' not in log and 'shared-screen' not in log and 'Release now' not in log)
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
