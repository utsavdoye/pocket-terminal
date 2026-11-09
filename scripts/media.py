# Rebuild every picture of the app from the app itself (demo mode), so the README and the website
# never show an old screen:
#   docs/screenshots/{agent,agents,files,localhost}.png (+ .webp)   README and website
#   docs/media/demo.{mp4,webm,gif} and poster.webp                  the phone video on the website, the GIF in the README
#   docs/og.png, brand/social-preview.png, docs/readme/hero.png     share image, GitHub preview, README banner (brand/banner.html)
# Run from the repo:  python3 scripts/media.py      (needs: pip install playwright pillow; ffmpeg)
import os, sys, time, shutil, subprocess, threading, http.server, functools, tempfile
from playwright.sync_api import sync_playwright
from PIL import Image

R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8955
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=R))
threading.Thread(target=srv.serve_forever, daemon=True).start()
APP = f'http://127.0.0.1:{PORT}/docs/app/#demo'
SHOTS = os.path.join(R, 'docs/screenshots'); MEDIA = os.path.join(R, 'docs/media')
errs = []

def phone(b, w=390, h=844, dpr=2):
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=dpr, has_touch=True, is_mobile=True, color_scheme='light')
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(APP); pg.wait_for_timeout(2500)
    return pg

def webp(png):
    im = Image.open(png); im.thumbnail((430, 932)); im.save(png[:-4] + '.webp', 'WEBP', quality=82)

with sync_playwright() as p:
    b = p.chromium.launch()

    # 1. Screenshots
    pg = phone(b)
    pg.click('#term'); pg.keyboard.type('claude\n'); pg.wait_for_selector('#needs:not([hidden])', timeout=15000); pg.wait_for_timeout(800)
    pg.screenshot(path=f'{SHOTS}/agent.png')
    pg.tap('[data-dock=sessions]'); pg.wait_for_timeout(900); pg.screenshot(path=f'{SHOTS}/agents.png')
    pg.tap('#sheetClose'); pg.wait_for_timeout(400)
    pg.tap('[data-dock=files]'); pg.wait_for_timeout(700); pg.click('.fi.dir >> nth=0'); pg.wait_for_timeout(600)
    pg.screenshot(path=f'{SHOTS}/files.png')
    pg.tap('#sheetBack'); pg.wait_for_timeout(300); pg.tap('[data-tab=web]'); pg.wait_for_timeout(600)
    pg.tap('[data-port="3000"]'); pg.wait_for_timeout(2500); pg.screenshot(path=f'{SHOTS}/localhost.png')
    for n in ['agents', 'files', 'localhost']: webp(f'{SHOTS}/{n}.png')
    pg.context.close()
    print('screenshots done')

    # 2. The demo video: an agent asks, one tap answers, then localhost opens.
    fd = tempfile.mkdtemp(); frames = []
    pg = phone(b, 430, 932)
    def snap(ms):
        end = time.time() + ms / 1000
        while True:
            fn = f'{fd}/{len(frames):05d}.jpg'; pg.screenshot(path=fn, type='jpeg', quality=92); frames.append((fn, time.time()))
            if time.time() >= end: break
    snap(900); pg.click('#term')
    for ch in 'claude': pg.keyboard.type(ch); snap(140)
    snap(300); pg.keyboard.press('Enter')
    for _ in range(100):
        snap(100)
        if pg.query_selector('#needs:not([hidden])'): break
    snap(1500); pg.tap('#needsBtns button.yes'); snap(2200)
    pg.tap('#menuBtn'); snap(700); pg.tap('[data-tab=web]'); snap(1200)
    pg.tap('[data-port="3000"]'); snap(2600)
    pg.context.close()
    with open(fd + '/list.txt', 'w') as L:
        for i, (fn, t) in enumerate(frames):
            d = (frames[i + 1][1] - t) if i + 1 < len(frames) else 1.0
            L.write(f"file '{fn}'\nduration {d:.4f}\n")
        L.write(f"file '{frames[-1][0]}'\n")
    ff = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', fd + '/list.txt']
    subprocess.run(ff + ['-vf', 'scale=430:-2,fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-movflags', '+faststart', f'{MEDIA}/demo.mp4'], check=True)
    subprocess.run(ff + ['-vf', 'scale=430:-2,fps=30', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', f'{MEDIA}/demo.webm'], check=True)
    subprocess.run(ff + ['-vf', 'fps=12,scale=280:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', f'{MEDIA}/demo.gif'], check=True)
    Image.open(frames[0][0]).save(f'{MEDIA}/poster.webp', 'WEBP', quality=80)
    shutil.rmtree(fd)
    print('video done', len(frames), 'frames')

    # 3. Share image, GitHub preview, README banner (they show the new agent.png)
    for out, w, h, dpr in [('docs/og.png', 1200, 630, 1), ('brand/social-preview.png', 1280, 640, 1), ('docs/readme/hero.png', 1280, 640, 2)]:
        ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=dpr); pg = ctx.new_page()
        pg.goto(f'http://127.0.0.1:{PORT}/brand/banner.html'); pg.wait_for_timeout(800); pg.screenshot(path=os.path.join(R, out)); ctx.close()
    print('banners done')
    b.close()
srv.shutdown()
if errs: print('page errors:', errs); sys.exit(1)
print('all pictures rebuilt')
