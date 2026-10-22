"""Build every logo size Ethos uses from the master artwork.

Run from the project root:  python -I scripts/build-icons.py

Source: imgs/new logo [1].png (800x800, RGBA). Outputs:
  assets/icon.ico        Windows executable, window, taskbar (16 to 256)
  assets/icon.png        512x512, Electron icon on other platforms
  assets/tray-16.png     tray icon, plus tray-16@2x.png (Electron picks the @2x
                         file on high-DPI screens)
  src/renderer/img/      logo-64, logo-128, logo-512 for the page (brand, intro,
                         About). The page can only load files under src/renderer.

At 16px the disc's orbit and the thin bracket turn to noise, so the 16px frame
is cropped to the middle of the artwork before it is shrunk.
"""

import os
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SOURCE = os.path.join(ROOT, 'imgs', 'new logo [1].png')
LANCZOS = Image.Resampling.LANCZOS


def square(img, size, crop=1.0):
    if crop < 1.0:
        side = img.width * crop
        left = (img.width - side) / 2
        img = img.crop((left, left, left + side, left + side))
    return img.resize((size, size), LANCZOS)


def save(img, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
    print('wrote', os.path.relpath(path, ROOT))


def main():
    master = Image.open(SOURCE).convert('RGBA')
    assert master.width == master.height, 'the logo must be square'

    ico_base = square(master, 256)
    ico_path = os.path.join(ROOT, 'assets', 'icon.ico')
    os.makedirs(os.path.dirname(ico_path), exist_ok=True)
    # Pillow writes each requested size from the base image.
    ico_base.save(ico_path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48),
                                   (64, 64), (128, 128), (256, 256)])
    print('wrote', os.path.relpath(ico_path, ROOT))

    save(square(master, 512), 'assets', 'icon.png')

    save(square(master, 16, crop=0.84), 'assets', 'tray-16.png')
    save(square(master, 32, crop=0.84), 'assets', 'tray-16@2x.png')

    for size in (64, 128, 512):
        save(square(master, size), 'src', 'renderer', 'img', 'logo-%d.png' % size)


if __name__ == '__main__':
    main()
