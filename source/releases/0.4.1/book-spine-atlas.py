"""Original typography/cloth artwork, not scanned covers or third-party branding.

Pillow 11.3.0; DejaVu Sans/Serif from the system fonts, recorded in the build report.
"""
import argparse
import hashlib
import json
from pathlib import Path
import random

import PIL
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
parser.add_argument("--out", required=True)
args = parser.parse_args()
assert PIL.__version__ == "11.3.0"
out = Path(args.out).resolve()
assert "build" in out.parts
out.parent.mkdir(parents=True, exist_ok=True)
fonts = [Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf")]
palette = ["29363B", "637369", "CBC2AE", "6F4035", "9C8C70", "324854", "555C4A", "9D7357"]
titles = ["FIELD NOTES", "FORM AND SPACE", "MATERIAL STUDIES", "PLACES", "DESIGN PRACTICE",
          "LIGHT AND COLOUR", "OBSERVATIONS", "STRUCTURES", "COLLECTED ESSAYS", "THE READING ROOM",
          "GARDEN JOURNAL", "OBJECTS IN USE", "WORKING PAPERS", "PROPORTION", "DRAWING", "LANDSCAPES"]
atlas = Image.new("RGB", (2112, 2048))
rng = random.Random(241)
for index in range(128):
    color = palette[(index // 4) % len(palette)]
    rgb = tuple(int(color[i:i+2], 16) for i in (0, 2, 4))
    tile = Image.new("RGB", (64, 512))
    pixels = []
    for y in range(512):
        for x in range(64):
            grain = rng.randrange(-2, 3) + (1 if x % 3 == 0 else 0)
            pixels.append(tuple(max(0, min(255, c+grain)) for c in rgb))
    tile.putdata(pixels)
    ink = "#DDD3B9" if sum(rgb) < 350 else "#343936"
    draw = ImageDraw.Draw(tile)
    # Horizontal composition rotated onto a vertical spine, with real blank margins.
    label = Image.new("RGBA", (380, 36))
    label_draw = ImageDraw.Draw(label)
    font = ImageFont.truetype(str(fonts[(index // 4) % 2]), 20)
    label_draw.text((12, 5), titles[(index // 4) % len(titles)], font=font, fill=ink)
    rotated = label.rotate(90, expand=True)
    tile.paste(rotated, (14, 48), rotated)
    small = ImageFont.truetype(str(fonts[0]), 15)
    draw.text((22, 455), f"{index % 4 + 1:02d}", font=small, fill=ink)
    draw.line((12, 436, 52, 436), fill=ink, width=1)
    atlas.paste(tile, ((index % 32)*64, (index // 32)*512))
draw = ImageDraw.Draw(atlas)
for y in range(2048):
    shade = -4 if y % 12 == 0 else 0
    draw.line((2048, y, 2111, y), fill=tuple(c+shade for c in (228, 220, 201)))
atlas.save(out, optimize=False)
finish = Image.new("RGB", (64, 1), (184, 184, 184))
finish.putpixel((62, 0), (230, 230, 230))
finish.putpixel((63, 0), (230, 230, 230))
finish_path = out.with_name("book-finish.png")
finish.save(finish_path)
out.with_suffix(".json").write_text(json.dumps({
    "origin": "project-authored fictional titles and procedural cloth; no scanned cover artwork",
    "pillow": PIL.__version__, "fonts": [{"name": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in fonts],
    "sha256": hashlib.sha256(out.read_bytes()).hexdigest(), "tiles": 128, "width": 2112, "height": 2048,
    "pageStrip": {"x": 2048, "width": 64, "purpose": "paper edges share the binding atlas, preserving one primitive per book"},
    "roughnessMask": {"name": finish_path.name, "sha256": hashlib.sha256(finish_path.read_bytes()).hexdigest(), "width": 64, "height": 1},
}, indent=2)+"\n")
