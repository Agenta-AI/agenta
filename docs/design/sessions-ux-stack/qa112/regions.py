#!/usr/bin/env python3
"""Emit a CONTACT SHEET of every differing region: prod above local, per region.

Usage: regions.py <slug> [maxRegions] [perSheet] [strip]

The failure this fixes: vrt.py RANKS regions, but if you only open the top crop you miss the
rest. This renders them all into a handful of sheets so every region gets looked at. Five real
findings were sitting in sheets nobody opened once.

`strip` is a name from strips.py or an "x,y,w,h" CSS box — run the hunt one strip at a time so a
big content block cannot bury small regions. Tile labels stay in full-page CSS coordinates.

Reading them: the tile is prod ON TOP, local BELOW, separated by a red rule. Beware the crop
boundary — a tile that clips a glyph differently top and bottom reads as a weight/colour change
that is not there. Confirm anything colour-shaped with zoom.py and a computed-style read.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import strips as S

QA = os.path.dirname(os.path.abspath(__file__))
THRESH, CELL, MIN_CELL_FRAC = 24, 8, 0.12
PAD = 14          # device px of context around each region
MIN_AREA = 1200   # ignore specks


def regions(mask, w, h):
    gh, gw = h // CELL, w // CELL
    grid = mask[: gh * CELL, : gw * CELL].reshape(gh, CELL, gw, CELL).mean(axis=(1, 3))
    hot = grid > MIN_CELL_FRAC
    seen = np.zeros_like(hot, dtype=bool)
    out = []
    for y in range(gh):
        for x in range(gw):
            if not hot[y, x] or seen[y, x]:
                continue
            stack, cells = [(y, x)], []
            seen[y, x] = True
            while stack:
                cy, cx = stack.pop()
                cells.append((cy, cx))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < gh and 0 <= nx < gw and hot[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            ys, xs = [c[0] for c in cells], [c[1] for c in cells]
            out.append((len(cells) * CELL * CELL, min(xs) * CELL, min(ys) * CELL,
                        (max(xs) + 1) * CELL, (max(ys) + 1) * CELL))
    out.sort(reverse=True)
    return out


def main(slug, max_regions=24, per_sheet=6, strip=None):
    label, box = S.resolve(strip)
    pa, pb = f"{QA}/shots/{slug}.prod.png", f"{QA}/shots/{slug}.local.png"
    for p in (pa, pb):
        if not os.path.exists(p):
            raise SystemExit(f"MISSING {p}")
    A, B = Image.open(pa).convert("RGB"), Image.open(pb).convert("RGB")
    w, h = min(A.size[0], B.size[0]), min(A.size[1], B.size[1])
    A, B = A.crop((0, 0, w, h)), B.crop((0, 0, w, h))
    DPR = S.dpr_of(A)
    Ac, (ox, oy) = S.crop(A, box, DPR)
    Bc, _ = S.crop(B, box, DPR)

    a, b = np.asarray(Ac).astype(np.int16), np.asarray(Bc).astype(np.int16)
    mask = np.abs(a - b).max(axis=2) > THRESH
    regs = [r for r in regions(mask, *Ac.size) if r[0] >= MIN_AREA][:max_regions]
    print(f"{len(regs)} regions >= {MIN_AREA}px  [{label}]")
    if not regs:
        return

    sheets, tiles = [], []
    for i, (area, x0, y0, x1, y1) in enumerate(regs, 1):
        cx0, cy0 = max(0, x0 - PAD), max(0, y0 - PAD)
        cx1, cy1 = min(Ac.size[0], x1 + PAD), min(Ac.size[1], y1 + PAD)
        ta, tb = Ac.crop((cx0, cy0, cx1, cy1)), Bc.crop((cx0, cy0, cx1, cy1))
        tw, th = ta.size
        tile = Image.new("RGB", (tw, th * 2 + 22), (10, 10, 10))
        tile.paste(ta, (0, 14))
        tile.paste(tb, (0, th + 18))
        d = ImageDraw.Draw(tile)
        d.rectangle([0, th + 14, tw, th + 17], fill=(220, 40, 40))
        d.text((3, 2), f"#{i} css({(cx0 + ox) // DPR},{(cy0 + oy) // DPR})-"
                       f"({(cx1 + ox) // DPR},{(cy1 + oy) // DPR}) {area}px", fill=(240, 210, 60))
        tiles.append(tile)
        if len(tiles) == per_sheet or i == len(regs):
            sw = max(t.size[0] for t in tiles)
            sh = sum(t.size[1] + 8 for t in tiles)
            sheet = Image.new("RGB", (sw, sh), (0, 0, 0))
            y = 0
            for t in tiles:
                sheet.paste(t, (0, y))
                y += t.size[1] + 8
            suffix = "" if box is None else f".{label.replace(':', '')}"
            p = f"{QA}/shots/{slug}{suffix}.SHEET{len(sheets)}.png"
            sheet.save(p)
            print(f"   {p} {sheet.size}")
            sheets.append(p)
            tiles = []


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(sys.argv[1],
         int(sys.argv[2]) if len(sys.argv) > 2 else 24,
         int(sys.argv[3]) if len(sys.argv) > 3 else 6,
         sys.argv[4] if len(sys.argv) > 4 else None)
