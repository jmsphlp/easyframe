"""Generate EasyFrame PWA icons.

Aesthetic: dark warm background (#0e0e0e) with the brand square glyph in warm amber.
For maskable, we keep the glyph within the 80% safe zone.
"""
from PIL import Image, ImageDraw, ImageFont
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "icons")
os.makedirs(OUT, exist_ok=True)

BG = (14, 14, 14)
ACCENT = (217, 119, 87)
INK = (243, 239, 230)


def make_icon(size: int, path: str, maskable: bool = False, ios: bool = False) -> None:
    img = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(img)

    # iOS icons should not have transparent corners (iOS clips them itself)
    # and a slight inset feels right on apple-touch icon
    safe = 0.8 if maskable else 1.0
    glyph_size = int(size * 0.55 * safe)

    # Draw a clean square outline (the ▢ mark)
    stroke = max(int(size * 0.04), 2)
    x0 = (size - glyph_size) // 2
    y0 = (size - glyph_size) // 2
    x1 = x0 + glyph_size
    y1 = y0 + glyph_size

    # Outer square — accent
    draw.rectangle([x0, y0, x1, y1], outline=ACCENT, width=stroke)

    # Inner accent dot — gives it a bit of character
    inner = int(glyph_size * 0.18)
    cx, cy = size // 2, size // 2
    draw.ellipse(
        [cx - inner // 2, cy - inner // 2, cx + inner // 2, cy + inner // 2],
        fill=INK,
    )

    img.save(path, "PNG", optimize=True)
    print(f"  wrote {path}  ({size}x{size})")


print("Generating EasyFrame icons...")
make_icon(192, f"{OUT}/icon-192.png")
make_icon(512, f"{OUT}/icon-512.png")
make_icon(180, f"{OUT}/icon-180.png", ios=True)
make_icon(512, f"{OUT}/icon-maskable-512.png", maskable=True)
print("Done.")
