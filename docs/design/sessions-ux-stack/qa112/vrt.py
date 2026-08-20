#!/usr/bin/env python3
"""Visual regression between two live builds (prod vs local dev).

Usage: vrt.py <slug> [strip] [align]

Reads  shots/<slug>.prod.png and shots/<slug>.local.png
Writes shots/<slug>[.<strip>][.aligned].DIFF.png  (3-up: prod | local | heatmap)
Prints differing regions as clustered boxes, largest first, in full-page CSS coordinates.

`strip` is a name from strips.py (sidebar / content / chat-body / ...) or an "x,y,w,h" CSS box.
Diff ONE strip at a time: whole-page runs let a big content block bury small regions.

`align` registers local onto prod inside the strip before diffing and prints the shift it used.
Read the UNALIGNED run first — alignment can hide a real offset as easily as it reveals what one
was masking. It exists because the playground's config/chat seam is a 9px gutter locally and a
flush border on prod (a deliberate design), which put the entire chat column a few px right of
prod's and reported 129 regions on an EMPTY chat. Aligned, the same capture reads 0.96%.

These are two different deployments, so exact pixel equality is never expected. The output is a
ranked map of WHERE they differ, not a pass/fail.
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import strips as S

QA = os.path.dirname(os.path.abspath(__file__))
THRESH = 24           # per-channel delta that counts as "different"
CELL = 8              # coarse grid for clustering
MIN_CELL_FRAC = 0.12  # fraction of pixels in a cell that must differ

# The rail's version stamp: `v0.112.1` on prod against `v0.112.2` on local. It is the one region
# guaranteed to differ between the two builds, which makes it the tell for a capture pair that is
# secretly one environment shot twice.
VERSION_STAMP_CSS = (168, 854, 60, 16)


def load(p):
    return Image.open(p).convert("RGB")


def hosts_of(slug):
    """(prod_host, local_host) from the sidecar URLs shot.sh writes, or (None, None) if absent."""
    out = []
    for env in ("prod", "local"):
        try:
            with open(f"{QA}/shots/{slug}.{env}.url") as f:
                u = f.read().strip()
            out.append(u.split("//", 1)[-1].split("/", 1)[0] or None)
        except OSError:
            out.append(None)
    return tuple(out)


def same_environment(A, B):
    """True when the version stamp is pixel-identical — i.e. both shots came from one tab.

    The stamp only carries signal on pages that RENDER the rail. On a page without it — the
    `/auth` screens have no sidebar — both crops are flat background, compare equal, and the guard
    fired on a perfectly good prod-vs-local pair. A blank crop proves nothing, so treat a uniform
    patch as "no evidence" rather than as evidence of sameness.
    """
    if A.size != B.size:
        return False
    dpr = S.dpr_of(A)
    a, _ = S.crop(A, VERSION_STAMP_CSS, dpr)
    b, _ = S.crop(B, VERSION_STAMP_CSS, dpr)
    if a.size[0] == 0 or a.size[1] == 0:
        return False
    arr = np.asarray(a)
    if int(np.ptp(arr)) < 8:  # flat patch: the stamp is not on this page
        return False
    return np.array_equal(arr, np.asarray(b))


def best_shift(a_full, b_full, box, dpr, span=20):
    """Device-px (dx, dy) that best registers local onto prod inside `box`."""
    x, y, w, h = (v * dpr for v in box)
    ref = a_full[y:y + h, x:x + w].astype(np.int16)
    best = (0, 0, None)
    for dy in range(-span // 2, span // 2 + 1, 2):
        for dx in range(-span, span + 1, 1):
            cand = b_full[y + dy:y + dy + h, x + dx:x + dx + w]
            if cand.shape != ref.shape:
                continue
            n = int((np.abs(ref - cand.astype(np.int16)).max(axis=2) > THRESH).sum())
            if best[2] is None or n < best[2]:
                best = (dx, dy, n)
    return best


def main(slug, strip=None, align=False):
    label, box = S.resolve(strip)
    pa, pb = f"{QA}/shots/{slug}.prod.png", f"{QA}/shots/{slug}.local.png"
    for p in (pa, pb):
        if not os.path.exists(p):
            print(f"MISSING {p}")
            return
    A, B = load(pa), load(pb)
    # Prefer the recorded hosts: an unambiguous, non-rotting tell. Fall back to the version stamp
    # for captures taken before shot.sh started writing the sidecar.
    ph, lh = hosts_of(slug)
    if ph and lh and ph == lh:
        print(f"!! {slug}: both captures came from {ph} — ONE environment shot twice. RE-CAPTURE.")
        return
    if (not ph or not lh) and same_environment(A, B):
        print(
            f"!! {slug}: prod and local captures are the SAME ENVIRONMENT — the version stamp\n"
            f"!! is pixel-identical, which cannot happen across v0.112.1 and v0.112.2.\n"
            f"!! `browse tab` no-opped and one tab was shot twice. RE-CAPTURE; any score below\n"
            f"!! is meaningless (this shipped a 0.00% 'perfect match' once)."
        )
        return
    # Report a size mismatch rather than scaling — scaling would invent differences. A mismatch
    # here almost always means one tab is at a different DPR: run `pin_tab local; pin_tab prod`.
    if A.size != B.size:
        print(f"! size differs prod={A.size} local={B.size} — comparing the common area."
              f" If this persists, the two tabs are at different DPR: re-run pin_tab.")
    w, h = min(A.size[0], B.size[0]), min(A.size[1], B.size[1])
    A, B = A.crop((0, 0, w, h)), B.crop((0, 0, w, h))

    DPR = S.dpr_of(A)
    if align and box is not None:
        dx, dy, _ = best_shift(np.asarray(A), np.asarray(B), box, DPR)
        sx, sy, sw, sh = (v * DPR for v in box)
        A = A.crop((sx, sy, sx + sw, sy + sh))
        B = B.crop((sx + dx, sy + dy, sx + dx + sw, sy + dy + sh))
        ox, oy = sx, sy
        print(f"[aligned] local shifted by ({dx},{dy}) device px = ({dx / DPR:+.1f},{dy / DPR:+.1f}) CSS")
    else:
        A, (ox, oy) = S.crop(A, box, DPR)
        B, _ = S.crop(B, box, DPR)
    w, h = A.size

    a = np.asarray(A).astype(np.int16)
    b = np.asarray(B).astype(np.int16)
    mask = np.abs(a - b).max(axis=2) > THRESH

    print(f"### {slug} [{label}]: {100.0 * mask.sum() / mask.size:.2f}% of pixels differ (threshold {THRESH})")

    # Coarse-grid clustering so the output is regions, not pixels.
    gh, gw = h // CELL, w // CELL
    grid = mask[: gh * CELL, : gw * CELL].reshape(gh, CELL, gw, CELL).mean(axis=(1, 3))
    hot = grid > MIN_CELL_FRAC

    seen = np.zeros_like(hot, dtype=bool)
    boxes = []
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
            boxes.append((len(cells), min(xs) * CELL + ox, min(ys) * CELL + oy,
                          (max(xs) + 1) * CELL + ox, (max(ys) + 1) * CELL + oy))
    boxes.sort(reverse=True)
    print(f"{len(boxes)} differing regions (DPR={DPR}; css = device/{DPR}):")
    for n, x0, y0, x1, y1 in boxes[:18]:
        print(f"   area={n * CELL * CELL:7d}px  box=({x0:4d},{y0:4d})-({x1:4d},{y1:4d})"
              f"  css=({x0 // DPR:4d},{y0 // DPR:4d})-({x1 // DPR:4d},{y1 // DPR:4d})")
    if len(boxes) > 18:
        print(f"   ... {len(boxes) - 18} more — run regions.py for the contact sheets, and OPEN THEM ALL")

    # 3-up output: prod | local | heatmap.
    heat = np.zeros((h, w, 3), dtype=np.uint8)
    heat[..., 0] = np.where(mask, 255, 0)
    base = np.asarray(A.convert("L")).astype(np.uint8) // 3
    for c in range(3):
        heat[..., c] = np.maximum(heat[..., c], base)
    out = Image.new("RGB", (w * 3 + 24, h), (16, 16, 16))
    out.paste(A, (0, 0))
    out.paste(B, (w + 12, 0))
    out.paste(Image.fromarray(heat), (w * 2 + 24 - 12, 0))
    suffix = "" if box is None else f".{label.replace(':', '')}"
    if align:
        suffix += ".aligned"
    p = f"{QA}/shots/{slug}{suffix}.DIFF.png"
    out.save(p)
    print(f"wrote {p}  (prod | local | heatmap)")


if __name__ == "__main__":
    args = sys.argv[1:]
    align = "align" in args
    args = [a for a in args if a != "align"]
    if not args:
        raise SystemExit(__doc__)
    main(args[0], args[1] if len(args) > 1 else None, align)
