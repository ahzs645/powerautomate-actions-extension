"""Generate the greyed-out toolbar icons shown while the toolkit is turned off.

Usage: python3 scripts/pa-platform/make-disabled-icons.py
Reads public/logo128.png and writes public/logo{16,48,128}-disabled.png.
Requires Pillow.
"""
import os
from PIL import Image, ImageOps

root = os.path.join(os.path.dirname(__file__), '..', '..', 'public')
src = Image.open(os.path.join(root, 'logo128.png')).convert('RGBA')
r, g, b, a = src.split()
grey = ImageOps.grayscale(Image.merge('RGB', (r, g, b)))
# Lift towards light grey so it reads as "inactive" on light and dark toolbars
grey = grey.point(lambda v: int(96 + v * 0.45))
alpha = a.point(lambda v: int(v * 0.75))
out = Image.merge('RGBA', (grey, grey, grey, alpha))
for size in (16, 48, 128):
    out.resize((size, size), Image.LANCZOS).save(os.path.join(root, f'logo{size}-disabled.png'), optimize=True)
    print('wrote', f'logo{size}-disabled.png')
