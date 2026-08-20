#!/usr/bin/env python3
"""zoom.py <slug> <x,y,w,h in CSS px> [scale]

Magnified prod-over-local view of ONE box, whether or not it differs.

regions.py only renders boxes the diff FLAGGED, so there was no way to look at a control that
reads clean numerically but wrong to the eye — which is how a 2px seam under the search button
got reported by a human rather than by the harness.

It is also the check on the contact sheets: two sheet tiles whose crop boundaries fall differently
made body text look brighter on one build, and a 6x zoom showed the glyphs were identical. When a
finding is colour- or weight-shaped, zoom it AND read the computed style before filing.

Writes shots/<slug>.zoom.png (prod on top, local below, red rule between).
"""
import sys

from PIL import Image, ImageDraw

import strips

QA = __file__.rsplit("/", 1)[0]


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    slug = sys.argv[1]
    box = tuple(int(v) for v in sys.argv[2].split(","))
    scale = int(sys.argv[3]) if len(sys.argv) > 3 else 4

    crops = []
    for env in ("prod", "local"):
        im = Image.open(f"{QA}/shots/{slug}.{env}.png").convert("RGB")
        dpr = strips.dpr_of(im)
        x, y, w, h = (v * dpr for v in box)
        c = im.crop((x, y, x + w, y + h))
        crops.append(c.resize((c.size[0] * scale, c.size[1] * scale), Image.NEAREST))

    w = max(c.size[0] for c in crops)
    h0, h1 = crops[0].size[1], crops[1].size[1]
    out = Image.new("RGB", (w, h0 + h1 + 6), (10, 10, 10))
    out.paste(crops[0], (0, 0))
    ImageDraw.Draw(out).rectangle([0, h0, w, h0 + 5], fill=(220, 40, 40))
    out.paste(crops[1], (0, h0 + 6))
    p = f"{QA}/shots/{slug}.zoom.png"
    out.save(p)
    print(f"prod (top) / local (bottom), {scale}x  ->  {p}")


if __name__ == "__main__":
    main()
