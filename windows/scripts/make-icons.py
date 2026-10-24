#!/usr/bin/env python3
"""Generates the app icons from the Android launcher art.

  build/icon.ico              16…256 px, used by electron-builder for the exe / installer
  resources/icon.png          512 px window / notification icon
  resources/tray.png|.ico     tray icon
  resources/thumbar/*.png     white 32 px glyphs for the taskbar thumbnail buttons

Run from `windows/`: python3 scripts/make-icons.py
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ART = os.path.join(ROOT, '..', 'android', 'app', 'src', 'main', 'res', 'drawable-nodpi', 'ic_launcher_background.png')


def rounded_icon(size: int) -> Image.Image:
    """The launcher art (full bleed) cut into a rounded square with a little transparent margin."""
    art = Image.open(ART).convert('RGBA')
    scale = 4
    big = size * scale
    margin = round(big * 0.04)
    inner = big - 2 * margin
    art = art.resize((inner, inner), Image.LANCZOS)
    mask = Image.new('L', (inner, inner), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, inner - 1, inner - 1), radius=round(inner * 0.2), fill=255)
    canvas = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    canvas.paste(art, (margin, margin), mask)
    return canvas.resize((size, size), Image.LANCZOS)


def glyph(kind: str, size: int = 32) -> Image.Image:
    scale = 8
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    white = (255, 255, 255, 255)
    u = s / 32  # design grid: 32 units

    def tri(points):
        d.polygon([(x * u, y * u) for x, y in points], fill=white)

    def bar(x0, y0, x1, y1):
        d.rounded_rectangle((x0 * u, y0 * u, x1 * u, y1 * u), radius=1.0 * u, fill=white)

    if kind == 'play':
        tri([(10, 6.5), (25, 16), (10, 25.5)])
    elif kind == 'pause':
        bar(8.5, 7, 13.5, 25)
        bar(18.5, 7, 23.5, 25)
    elif kind == 'next':
        tri([(7, 7.5), (20, 16), (7, 24.5)])
        bar(21, 7.5, 25, 24.5)
    elif kind == 'prev':
        tri([(25, 7.5), (12, 16), (25, 24.5)])
        bar(7, 7.5, 11, 24.5)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
    os.makedirs(os.path.join(ROOT, 'resources', 'thumbar'), exist_ok=True)

    master = rounded_icon(1024)
    master.resize((512, 512), Image.LANCZOS).save(os.path.join(ROOT, 'resources', 'icon.png'))

    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [rounded_icon(n) for n in ico_sizes]
    frames[-1].save(os.path.join(ROOT, 'build', 'icon.ico'), format='ICO', sizes=[(n, n) for n in ico_sizes],
                    append_images=frames[:-1])
    master.resize((256, 256), Image.LANCZOS).save(os.path.join(ROOT, 'build', 'icon.png'))

    tray_sizes = [16, 20, 24, 32, 40, 48]
    tray = [rounded_icon(n) for n in tray_sizes]
    tray[-1].save(os.path.join(ROOT, 'resources', 'tray.ico'), format='ICO', sizes=[(n, n) for n in tray_sizes],
                  append_images=tray[:-1])
    rounded_icon(32).save(os.path.join(ROOT, 'resources', 'tray.png'))

    for kind in ('prev', 'play', 'pause', 'next'):
        glyph(kind).save(os.path.join(ROOT, 'resources', 'thumbar', kind + '.png'))
    print('icons written')


if __name__ == '__main__':
    main()
