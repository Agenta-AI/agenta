#!/usr/bin/env python3
"""
Variant-value extractor: for each antd component call-site, record the LITERAL
values passed to variant-defining props (type, size, variant, color, shape,
placement, danger, mode, status, ...). Answers "which variants of X do we use?".

Usage: python3 variants.py <package_src_dir>
Consumes the site index the same way extract.py does (re-scans, self-contained).
"""

import os
import re
import sys
from collections import Counter, defaultdict

# variant-defining props per component (extend as needed)
VARIANT_PROPS = {
    "Button": ["type", "size", "shape", "danger", "variant", "color", "block", "ghost"],
    "Input": ["variant", "size", "type", "status"],
    "Select": ["variant", "size", "mode", "status"],
    "InputNumber": ["variant", "size"],
    "Tag": ["color", "variant", "bordered"],
    "Tooltip": ["placement", "color"],
    "Popover": ["placement", "trigger"],
    "Dropdown": ["placement", "trigger"],
    "Spin": ["size"],
    "Skeleton": ["size", "shape", "active"],
    "Switch": ["size"],
    "Progress": ["type", "size", "status"],
    "Space": ["size", "direction"],
    "Avatar": ["size", "shape"],
    "Divider": ["type", "orientation"],
    "Tabs": ["type", "size"],
    "Modal": ["centered"],
    "Typography": ["type", "level"],
    "Badge": ["status", "size"],
    "Radio": ["size"],
    "Checkbox": [],
    "Segmented": ["size"],
    "Alert": ["type", "banner"],
}

VALUE_IMPORT = re.compile(
    r"import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['\"]antd['\"]", re.S
)


def imported_components(txt):
    out = set()
    for m in VALUE_IMPORT.finditer(txt):
        for raw in m.group(1).split(","):
            s = raw.strip()
            if s.startswith("type "):
                continue
            n = s.split(" as ")[0].strip()
            if n:
                out.add(n)
    return out


def opening_tag(txt, idx):
    """From '<' index, return the opening-tag inner text (quote/brace aware)."""
    i = idx
    depth = 0
    quote = None
    buf = []
    n = len(txt)
    while i < n:
        ch = txt[i]
        if quote:
            if ch == quote:
                quote = None
        elif ch in "\"'`":
            quote = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        elif ch == ">" and depth == 0:
            break
        buf.append(ch)
        i += 1
    return "".join(buf)


def prop_value(tag, prop):
    # prop="literal"
    m = re.search(rf'(?:^|\s){re.escape(prop)}="([^"]*)"', tag)
    if m:
        return m.group(1)
    m = re.search(rf"(?:^|\s){re.escape(prop)}='([^']*)'", tag)
    if m:
        return m.group(1)
    # prop={ ... }  -> capture short expr
    m = re.search(rf"(?:^|\s){re.escape(prop)}=\{{([^{{}}]{{0,40}})\}}", tag)
    if m:
        return "{" + m.group(1).strip() + "}"
    # boolean prop (bare)
    if re.search(rf"(?:^|\s){re.escape(prop)}(\s|/|>|$)", tag):
        return "(bare true)"
    return None


def walk(root):
    for dp, _, fs in os.walk(root):
        if any(s in dp for s in ("/node_modules/", "/dist/", "/.next/")):
            continue
        for f in fs:
            if f.endswith((".tsx", ".ts")) and not f.endswith(".d.ts"):
                yield os.path.join(dp, f)


def main():
    root = sys.argv[1]
    results = defaultdict(
        lambda: defaultdict(Counter)
    )  # comp -> prop -> Counter(value)
    site_counts = Counter()
    for p in walk(root):
        try:
            txt = open(p, encoding="utf-8").read()
        except Exception:
            continue
        comps = imported_components(txt) & set(VARIANT_PROPS)
        for comp in comps:
            for m in re.finditer(r"<" + re.escape(comp) + r"(\.\w+)?(\s|>|/)", txt):
                sub = m.group(1) or ""
                tag = opening_tag(txt, m.start())
                key = comp + sub
                site_counts[key] += 1
                for prop in VARIANT_PROPS[comp]:
                    v = prop_value(tag, prop)
                    if v is not None:
                        results[key][prop][v] += 1
                if comp == "Typography" and sub:
                    # record subcomponent as a "variant"
                    results[comp][".sub"][sub.lstrip(".")] += 1
    for comp in sorted(results, key=lambda c: -site_counts[c]):
        print(f"\n### {comp}  ({site_counts[comp]} sites)")
        for prop, ctr in results[comp].items():
            vals = ", ".join(f"{v}×{c}" for v, c in ctr.most_common())
            unset = site_counts[comp] - sum(ctr.values())
            tail = f"  (+{unset} unset→default)" if unset > 0 else ""
            print(f"    {prop}: {vals}{tail}")


if __name__ == "__main__":
    main()
