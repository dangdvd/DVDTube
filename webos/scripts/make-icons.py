#!/usr/bin/env python3
"""Generates the webOS app icons and the splash screen from the Android launcher icon.

  assets/icon80.png    80×80   appinfo "icon" (launcher bar)
  assets/icon130.png   130×130 appinfo "largeIcon"
  assets/splash.png    1920×1080 appinfo "splashBackground" (dark, logo + "DVDTube")

Run from `webos/`: python3 scripts/make-icons.py   (or `npm run icons`)
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SOURCE = os.path.join(ROOT, '..', 'android', 'app', 'src', 'main', 'res', 'mipmap-xxxhdpi', 'ic_launcher.png')
OUT = os.path.join(ROOT, 'assets')

BACKGROUND = (15, 15, 15, 255)
BRAND = (255, 61, 90, 255)


def icon(size: int) -> Image.Image:
    art = Image.open(SOURCE).convert('RGBA')
    # Supersample, then shrink: crisp edges at 80 / 130 px.
    big = art.resize((size * 4, size * 4), Image.LANCZOS)
    return big.resize((size, size), Image.LANCZOS)


def font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    candidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
        '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
        'C:/Windows/Fonts/arialbd.ttf',
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def splash() -> Image.Image:
    w, h = 1920, 1080
    img = Image.new('RGBA', (w, h), BACKGROUND)
    # A soft brand glow behind the logo.
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    d.ellipse((w // 2 - 330, h // 2 - 400, w // 2 + 330, h // 2 + 120), fill=(255, 61, 90, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    img = Image.alpha_composite(img, glow)
    logo = icon(280)
    img.paste(logo, (w // 2 - 140, h // 2 - 280), logo)
    d = ImageDraw.Draw(img)
    title = 'DVDTube'
    f = font(96)
    box = d.textbbox((0, 0), title, font=f)
    d.text(((w - (box[2] - box[0])) // 2, h // 2 + 40), title, font=f, fill=(255, 255, 255, 255))
    sub = 'YouTube không quảng cáo'
    f2 = font(40, bold=False)
    box2 = d.textbbox((0, 0), sub, font=f2)
    d.text(((w - (box2[2] - box2[0])) // 2, h // 2 + 170), sub, font=f2, fill=(170, 170, 170, 255))
    return img


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    icon(80).save(os.path.join(OUT, 'icon80.png'), optimize=True)
    icon(130).save(os.path.join(OUT, 'icon130.png'), optimize=True)
    splash().convert('RGB').save(os.path.join(OUT, 'splash.png'), optimize=True)
    print('wrote assets/icon80.png, assets/icon130.png, assets/splash.png')


if __name__ == '__main__':
    main()
