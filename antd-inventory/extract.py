#!/usr/bin/env python3
"""
antd usage extractor for the antd->shadcn inventory.

Usage:
    python3 extract.py <package_src_dir> [--json out.json]

Emits, per antd component actually imported from "antd" (or "antd/es/*"):
  - value vs type-only import file counts
  - every JSX call-site (file:line) for value components
  - the set + frequency of PROPS used at those call-sites (drives prop-mapping tables)
  - a compact console summary

This is deliberately regex-based (no TS parser dependency) but handles:
  - multi-line `import { ... } from "antd"`
  - `import type { ... }` and inline `type X` specifiers  -> type-only
  - aliased specifiers `X as Y`
  - subpath imports `antd/es/table` (recorded separately)
  - JSX sites `<Comp`, `<Comp.Sub`, self-closing and block
Limitations: props are collected per opening tag via a best-effort brace/quote-aware
scan; spread props (`{...x}`) are recorded as "...".
"""

import os
import re
import sys
import json
from collections import Counter, defaultdict

VALUE_IMPORT = re.compile(
    r"import\s+(type\s+)?\{([^}]*)\}\s+from\s+['\"]antd['\"]", re.S
)
SUB_IMPORT = re.compile(
    r"import\s+(type\s+)?(?:\{([^}]*)\}|(\w+))\s+from\s+['\"]antd/([^'\"]+)['\"]", re.S
)


def specifiers(block):
    """Yield (name, is_type_only) from an import specifier block."""
    for raw in block.split(","):
        s = raw.strip()
        if not s:
            continue
        is_type = s.startswith("type ")
        if is_type:
            s = s[len("type ") :].strip()
        name = s.split(" as ")[0].strip()
        if name:
            yield name, is_type


def walk(root):
    for dp, _, files in os.walk(root):
        # skip build/test noise
        if any(seg in dp for seg in ("/node_modules/", "/dist/", "/.next/")):
            continue
        for f in files:
            if f.endswith((".tsx", ".ts")) and not f.endswith(".d.ts"):
                yield os.path.join(dp, f)


def find_jsx_sites(txt, comp):
    """Return list of (line, propstring) for <comp ...> and <comp.Sub ...> sites."""
    sites = []
    # match <Comp or <Comp.Sub  followed by whitespace, > or /
    pat = re.compile(r"<" + re.escape(comp) + r"(\.\w+)?(\s|>|/)")
    for m in pat.finditer(txt):
        start = m.start()
        line = txt.count("\n", 0, start) + 1
        # capture until the matching end of the opening tag (naive: first unquoted >)
        i = m.end() - 1
        depth = 0
        buf = []
        quote = None
        n = len(txt)
        j = i
        while j < n:
            ch = txt[j]
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
            j += 1
        sites.append((line, "".join(buf)))
    return sites


PROP_RE = re.compile(r"(?:^|\s)(\{\.\.\.|\w[\w-]*)(=)?")


def extract_props(propstr):
    props = []
    for m in re.finditer(r"(?:^|\s)([A-Za-z_][\w-]*)=|(\{\.\.\.)", propstr):
        if m.group(1):
            props.append(m.group(1))
        elif m.group(2):
            props.append("...")
    return props


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    root = sys.argv[1]
    out_json = None
    if "--json" in sys.argv:
        out_json = sys.argv[sys.argv.index("--json") + 1]

    value_files = defaultdict(set)  # comp -> files (value import)
    type_files = defaultdict(set)  # comp -> files (type-only import)
    sub_imports = defaultdict(set)  # "antd/es/x::Name" -> files
    all_files = list(walk(root))

    for p in all_files:
        try:
            txt = open(p, encoding="utf-8").read()
        except Exception:
            continue
        for m in VALUE_IMPORT.finditer(txt):
            block_type_only = bool(m.group(1))
            for name, is_type in specifiers(m.group(2)):
                if block_type_only or is_type:
                    type_files[name].add(p)
                else:
                    value_files[name].add(p)
        for m in SUB_IMPORT.finditer(txt):
            block_type_only = bool(m.group(1))
            sub = m.group(4)
            names = m.group(2) or m.group(3) or ""
            for name, is_type in specifiers(names) if m.group(2) else [(names, False)]:
                key = f"antd/{sub}::{name}"
                sub_imports[key].add(
                    p + ("  [type]" if block_type_only or is_type else "")
                )

    # JSX sites + props for value components
    site_index = defaultdict(list)  # comp -> [(file, line)]
    prop_freq = defaultdict(Counter)
    for comp, files in value_files.items():
        for p in files:
            try:
                txt = open(p, encoding="utf-8").read()
            except Exception:
                continue
            for line, propstr in find_jsx_sites(txt, comp):
                rel = os.path.relpath(p, root)
                site_index[comp].append((rel, line))
                for pr in extract_props(propstr):
                    prop_freq[comp][pr] += 1

    # ---- console summary ----
    print(f"# antd extraction for {root}")
    print(f"# {len(all_files)} ts/tsx files scanned\n")
    print("## Value components (files / jsx-sites)")
    rows = sorted(value_files.items(), key=lambda kv: -len(kv[1]))
    for comp, files in rows:
        sites = site_index.get(comp, [])
        print(f"{len(files):3d}f {len(sites):3d}s  {comp}")
    print("\n## Type-only imports (files)")
    for comp, files in sorted(type_files.items(), key=lambda kv: -len(kv[1])):
        # if also a value import somewhere, still list
        print(f"{len(files):3d}f       {comp}")
    print("\n## antd/es/* subpath imports")
    for key, files in sorted(sub_imports.items(), key=lambda kv: -len(kv[1])):
        print(f"{len(files):3d}f       {key}")
    print("\n## Prop frequency per value component")
    for comp, _ in rows:
        pf = prop_freq.get(comp)
        if not pf:
            print(
                f"\n### {comp}: (no direct <{comp}> jsx sites — used via spread/dynamic)"
            )
            continue
        top = ", ".join(f"{p}×{c}" for p, c in pf.most_common())
        print(f"\n### {comp} ({len(site_index[comp])} sites)\n{top}")

    if out_json:
        data = {
            "root": root,
            "files_scanned": len(all_files),
            "value": {
                k: sorted(os.path.relpath(x, root) for x in v)
                for k, v in value_files.items()
            },
            "type_only": {
                k: sorted(os.path.relpath(x, root) for x in v)
                for k, v in type_files.items()
            },
            "sub_imports": {k: sorted(v) for k, v in sub_imports.items()},
            "sites": {k: v for k, v in site_index.items()},
            "prop_freq": {k: dict(v) for k, v in prop_freq.items()},
        }
        json.dump(data, open(out_json, "w"), indent=2)
        print(f"\n[wrote {out_json}]")


if __name__ == "__main__":
    main()
