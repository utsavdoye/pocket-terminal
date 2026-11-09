# Rebuild every picture of the app from the app itself (demo mode), so the README and the website
# never show an old screen:
#   docs/screenshots/{agent,agents,files,localhost}.png (+ .webp)   README and website
#   docs/media/demo.{mp4,webm,gif} and poster.webp                  the phone video on the website, the GIF in the README
#   docs/og.png, brand/social-preview.png, docs/readme/hero.png     share image, GitHub preview, README banner (brand/banner.html)
#   docs/readme/night-on-battery.svg                                 the wake-up schedule picture in the README
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

# 0. The README's "night on battery" picture, drawn from the smart wake-up schedule (no browser needed)
def night_svg():
    import sys
    X0, W, MIN = 90, 1100, 540            # 22:00 → 07:00
    x = lambda m: X0 + W * m / MIN         # m = minutes after 22:00
    USE_END, FAST_END, MIN_END, PLUG = 20, 50, 170, 510   # 22:20, 22:50, 00:50, 06:30
    o = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 380" font-family="-apple-system, \'Segoe UI\', Helvetica, Arial, sans-serif">',
         '<rect width="1280" height="380" rx="24" fill="#0F1220"/>',
         '<text x="90" y="56" fill="#E9E7F2" font-size="24" font-weight="600">A night on battery, lid closed</text>',
         '<text x="90" y="84" fill="#8D91AE" font-size="16">Each amber tick is a quick check-in: a few seconds awake, then back to sleep. Smart schedule (the default).</text>',
         f'<rect x="{X0}" y="170" width="{W}" height="56" rx="10" fill="#171B2D"/>',
         f'<rect x="{X0}" y="170" width="{x(USE_END)-X0:.1f}" height="56" rx="10" fill="#F4B740"/>',
         f'<rect x="{x(PLUG):.1f}" y="170" width="{X0+W-x(PLUG):.1f}" height="56" rx="10" fill="#F4B740"/>']
    # every 20 s right after use: dense enough to read as a band
    o.append(f'<rect x="{x(USE_END):.0f}" y="180" width="{x(FAST_END)-x(USE_END):.0f}" height="36" fill="#F4B740" opacity=".7"/>')
    o.append(f'<rect x="{x(FAST_END):.0f}" y="180" width="{x(MIN_END)-x(FAST_END):.0f}" height="36" fill="#F4B740" opacity=".42"/>')
    t = MIN_END + 1  # 3-min grid
    while t < PLUG: o.append(f'<rect x="{round(x(t))}" y="180" width="2" height="36" fill="#F4B740" opacity=".8"/>'); t += 3
    ev = 310  # 03:10
    o += [f'<line x1="{x(ev):.1f}" y1="150" x2="{x(ev):.1f}" y2="246" stroke="#E9E7F2" stroke-width="2"/>',
          f'<circle cx="{x(ev):.1f}" cy="150" r="6" fill="#E9E7F2"/>',
          f'<text x="{x(ev):.1f}" y="132" fill="#E9E7F2" font-size="15" text-anchor="middle">03:10 you send "git pull"</text>',
          f'<text x="{x(ev):.1f}" y="268" fill="#4FD1A1" font-size="15" text-anchor="middle">runs at the next check-in (within 3 min), reply on your phone</text>',
          f'<text x="{(X0+x(USE_END))/2:.1f}" y="268" fill="#C9C7DA" font-size="14" text-anchor="middle">you\'re using it</text>',
          f'<text x="{x(USE_END):.1f}" y="152" fill="#C9C7DA" font-size="14">every 20 s</text>',
          f'<text x="{x(75):.1f}" y="152" fill="#C9C7DA" font-size="14">every 1 min</text>',
          f'<text x="{x(MIN_END)+6:.1f}" y="152" fill="#C9C7DA" font-size="14">then every 3 min at night</text>',
          f'<text x="{(x(PLUG)+X0+W)/2:.1f}" y="268" fill="#C9C7DA" font-size="14" text-anchor="middle">plugged in: instant</text>']
    for h in range(10):
        o.append(f'<text x="{x(h*60):.1f}" y="320" fill="#5D6283" font-size="14" text-anchor="middle">{(22+h)%24:02d}:00</text>')
    o.append('</svg>')
    open(os.path.join(R, 'docs/readme/night-on-battery.svg'), 'w').write('\n'.join(o) + '\n')
night_svg()


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
