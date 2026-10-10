"""Draws the Hadid plate icon into the Android resource folders (needs Pillow). Run: python tools/make-icons.py"""
import math, os, glob
from PIL import Image, ImageDraw
RES = os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res')
INK, RIM, KNURL, ACC, HUB = (15, 15, 14), (38, 35, 31), (59, 54, 47), (255, 77, 26), (20, 19, 15)

def plate(size, full=1.0, bg=None):
    """Plate drawn on a transparent (or bg) canvas; `full` = fraction of the canvas the plate's diameter fills."""
    S = size * 4; im = Image.new('RGBA', (S, S), bg or (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    c = S / 2; R = S * full / 2
    d.ellipse([c - R, c - R, c + R, c + R], fill=RIM + (255,))
    for i in range(48):                                   # knurled edge
        a = i / 48 * 2 * math.pi; r1, r2 = R * .93, R * .985
        d.line([c + r1 * math.cos(a), c + r1 * math.sin(a), c + r2 * math.cos(a), c + r2 * math.sin(a)], fill=KNURL + (255,), width=max(2, int(S * .006)))
    ring = R * .74                                         # progress arc, 300 degrees, open at the top-right
    aw = R * .13; d.arc([c - ring - aw / 2, c - ring - aw / 2, c + ring + aw / 2, c + ring + aw / 2], start=-60, end=240, fill=ACC + (255,), width=int(R * .13))
    for ang in (-60, 240):                                 # round caps
        a = math.radians(ang); x, y = c + ring * math.cos(a), c + ring * math.sin(a); w = R * .065
        d.ellipse([x - w, y - w, x + w, y + w], fill=ACC + (255,))
    hub = R * .56; d.ellipse([c - hub, c - hub, c + hub, c + hub], fill=HUB + (255,))
    bw, bh, gap = R * .13, R * .5, R * .17                 # a bold H
    for x0 in (c - gap - bw, c + gap):
        d.rectangle([x0, c - bh / 2, x0 + bw, c + bh / 2], fill=ACC + (255,))
    d.rectangle([c - gap, c - bw / 2, c + gap, c + bw / 2], fill=ACC + (255,))
    return im.resize((size, size), Image.LANCZOS)

def rounded_tile(size):
    base = Image.new('RGBA', (size, size), INK + (255,)); p = plate(size, .8)
    base.alpha_composite(p); m = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1], radius=size * 4 * .22, fill=255)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0)); out.paste(base, (0, 0), m.resize((size, size), Image.LANCZOS)); return out

def circle(size):
    base = Image.new('RGBA', (size, size), INK + (255,)); base.alpha_composite(plate(size, .8))
    m = Image.new('L', (size * 4, size * 4), 0); ImageDraw.Draw(m).ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0)); out.paste(base, (0, 0), m.resize((size, size), Image.LANCZOS)); return out

legacy = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
adaptive = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
for dens in legacy:
    d = os.path.join(RES, 'mipmap-' + dens)
    rounded_tile(legacy[dens]).save(os.path.join(d, 'ic_launcher.png'))
    circle(legacy[dens]).save(os.path.join(d, 'ic_launcher_round.png'))
    plate(adaptive[dens], .56).save(os.path.join(d, 'ic_launcher_foreground.png'))  # inside the 66dp safe zone of the 108dp canvas
open(os.path.join(RES, 'values', 'ic_launcher_background.xml'), 'w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0F0F0E</color>\n</resources>\n')

# splash: one flat colour, no stretched bitmap
for f in glob.glob(os.path.join(RES, 'drawable*', 'splash.png')): os.remove(f)
open(os.path.join(RES, 'drawable', 'splash.xml'), 'w').write('<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n    <solid android:color="#0F0F0E"/>\n</shape>\n')
big = plate(1024, .9, INK + (255,)); big.convert('RGB').save(os.path.join(os.path.dirname(__file__), '..', 'store-icon-1024.png'))
print('icons written')
