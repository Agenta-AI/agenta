#!/usr/bin/env python3
"""Named page strips, in CSS px, shared by vrt.py and regions.py.

Why this exists: a whole-page diff lets one big content block bury small-but-real regions
elsewhere. Measured proof — the same capture read 2.08% differing whole-page while the sidebar
strip alone read 7.30%. Always diff a strip at a time, and open EVERY contact sheet.

A strip is (x, y, w, h) in CSS px. Device px = CSS * DPR, and DPR is DERIVED from the capture
width rather than hardcoded: the headed browser hands out deviceScaleFactor 1 in some windows and
2 in others, and a hardcoded factor silently mis-crops one of the pair. Pass a name, or an
explicit "x,y,w,h" box, as the optional strip argument to either tool.
"""

VIEWPORT_CSS_W = 1800  # the CSS viewport both envs are pinned to (1800x942)


def dpr_of(img):
    """Device-pixel ratio of a capture, from its width. Falls back to 1."""
    return max(1, round(img.size[0] / VIEWPORT_CSS_W))


# Measured live on BOTH builds at the 1800x942 CSS viewport this comparison uses.
STRIPS = {
    "full": None,                            # whole viewport
    "sidebar": (0, 0, 256, 942),             # the rail: <aside> is 0..255 on prod and local
    "content": (256, 0, 1544, 942),          # everything right of the rail
    "content-top": (256, 0, 1544, 320),      # page header + description + toolbar
    "content-body": (256, 320, 1544, 622),   # the table / canvas below it
    # Playground. Config pane is 256..696 on both. The seam differs: prod's antd `Splitter` bar is
    # 0 layout px (its dragger is absolutely positioned) so the chat panel starts at 696/697;
    # the kit `SplitPane` spends a real 9px gutter, so local's starts at 705. That gutter is
    # DELIBERATE (Arda's call) — the strips stay inside the common area rather than straddling it.
    "config": (258, 0, 436, 942),
    "config-top": (258, 0, 436, 320),
    "chat": (710, 0, 1080, 942),
    # The session TAB ROW (y 51..79) carries one chip per session, so its width is pure data: the
    # two projects hold different session counts and the chips push each other along the row.
    # Diffing `chat` therefore reports the tab strip on every capture and buries the conversation
    # underneath it. `chat-body` starts below the row so the conversation, the tool steps and the
    # composer are compared on their own; diff `chat` as well when the strip IS the subject.
    "chat-body": (710, 90, 1080, 852),
}


def resolve(spec):
    """name | 'x,y,w,h' | None -> (label, css box or None)."""
    if not spec:
        return "full", None
    if spec in STRIPS:
        return spec, STRIPS[spec]
    parts = spec.split(",")
    if len(parts) != 4:
        raise SystemExit(
            f"unknown strip {spec!r}; use one of {sorted(STRIPS)} or 'x,y,w,h' in CSS px"
        )
    return "box:" + spec, tuple(int(p) for p in parts)


def crop(img, box, dpr=None):
    """Crop a device-px image to a CSS-px box, clamped to the image."""
    if box is None:
        return img, (0, 0)
    if dpr is None:
        dpr = dpr_of(img)
    x, y, w, h = (v * dpr for v in box)
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(img.size[0], x + w), min(img.size[1], y + h)
    return img.crop((x0, y0, x1, y1)), (x0, y0)
