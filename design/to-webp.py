"""Write the page's copies of Hora's artwork as WebP, from the PNG originals kept in design/.
   python3 design/to-webp.py
The PNGs are what the image tool produced (about 1.5 MB each); the page serves the WebP copies.
Frame layouts are unchanged: same pixel dimensions, same transparency."""
from pathlib import Path
from PIL import Image

here = Path(__file__).resolve().parent
for name in ("hora-peek", "hora-reach", "hora-typing"):
    source = Image.open(here / f"{name}.png").convert("RGBA")
    target = here.parent / "public" / f"{name}.webp"
    source.save(target, "WEBP", quality=90, alpha_quality=100, method=6)
    again = Image.open(target)
    assert again.size == source.size and again.mode == "RGBA", name
    print(f"{name}: {source.size[0]}x{source.size[1]}  {(here / (name + '.png')).stat().st_size // 1024} KB png -> {target.stat().st_size // 1024} KB webp")
