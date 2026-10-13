"""Cut the character out of her near-white background and write the images the page uses.
   python3 cutout.py SOURCE OUT_DIR
Background is found by flood fill from the picture's edges, so the white of her dress stays."""
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import numpy as np

source, out = sys.argv[1], sys.argv[2]
img = Image.open(source).convert("RGB")
w, h = img.size
print("source", w, h, "corner colours", img.getpixel((3, 3)), img.getpixel((w - 4, h - 4)))

MAGIC = (255, 0, 255)
work = img.copy()
seeds = [(x, y) for x in range(0, w, 16) for y in (0, h - 1)] + [(x, y) for y in range(0, h, 16) for x in (0, w - 1)]
for seed in seeds:
    if work.getpixel(seed) != MAGIC:
        r, g, b = work.getpixel(seed)
        if min(r, g, b) > 225:                      # only start from the pale background itself
            ImageDraw.floodfill(work, seed, MAGIC, thresh=26)
background = np.all(np.array(work) == MAGIC, axis=-1)
print("background share: %.1f%%" % (background.mean() * 100))

# The soft shadow on the ground and the faint glow marks above the eye are paler than the
# flood's threshold in places and darker in others: remove what is left of them by rule.
rgb = np.array(img).astype(np.int16)
lum, sat = rgb.sum(-1) / 3, rgb.max(-1) - rgb.min(-1)
ys, xs = np.mgrid[0:h, 0:w]
ground = (ys > h * 0.895) & (lum > 185) & (sat < 70)
glow = (ys < h * 0.135) & (lum > 150) & (sat < 120)
background |= ground | glow

mask = Image.fromarray((~background * 255).astype(np.uint8), "L")
mask = mask.filter(ImageFilter.GaussianBlur(0.7))   # soften the edge without eating her thin lines
cut = img.convert("RGBA"); cut.putalpha(mask)
box = cut.getbbox(); cut = cut.crop(box)
print("cut out to", cut.size, "from box", box)

def save(image, name, height, quality=88):
    scaled = image.resize((round(image.width * height / image.height), height), Image.LANCZOS)
    scaled.save(f"{out}/{name}", "WEBP", quality=quality, method=6)
    print(name, scaled.size)

save(cut, "character.webp", 880)
# Her face, for the small picture beside a reply: a square around the head, eye and all.
cw, ch = cut.size
head = cut.crop((round(cw * 0.22), 0, round(cw * 0.78), round(ch * 0.50)))
side = max(head.size); square = Image.new("RGBA", (side, side), (0, 0, 0, 0)); square.paste(head, ((side - head.width) // 2, side - head.height))
save(square, "character-head.webp", 256, 90)
# A check picture on dark, to see the edge.
check = Image.new("RGBA", cut.size, (11, 14, 36, 255)); check.alpha_composite(cut)
check.convert("RGB").resize((cut.width // 2, cut.height // 2), Image.LANCZOS).save(f"{out}/../artifacts/character-on-dark.png")
