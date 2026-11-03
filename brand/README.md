# Pocket Terminal brand

**The mark:** a jeans pocket (amber) holding a terminal prompt `>_`, on a dark rounded square.
Pocket = it lives on your phone. Prompt = it's your real terminal. The amber is the app's "lamp" colour.

| File | Use |
|---|---|
| `mark.svg` | The logo. Everywhere by default (README, app icon, docs). |
| `favicon.svg` | Browser tabs: no stitches, bigger pocket, reads at 16 px. |
| `square.svg` | Full-bleed version for iPhone home screens (iOS rounds the corners itself). |
| `maskable.svg` | Android adaptive icons: everything inside the safe zone. |
| `banner.html` | Source of the share image (`docs/og.png`, 1200×630), the GitHub social preview (`social-preview.png`, 1280×640) and `docs/readme/hero.png`. |

**Colours:** amber `#F5B843` (pocket gradient `#FFC95C → #F0A92C`), ink `#0F1217`, night `#1B2130 → #0B0D12`, paper `#F4F5F7`.
**Type:** IBM Plex Sans 600 for the name, JetBrains Mono for anything that's code.

**Don'ts:** don't recolour the pocket, don't put the mark on amber, don't stretch it, keep at least 1/4 of its width as clear space.

Rendered files live in `docs/` (`favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, `og.png`) and `docs/app/` (`icon.svg`, `icon.png`, `icon-192.png`, `icon-maskable.png`, `apple-touch-icon.png`).
