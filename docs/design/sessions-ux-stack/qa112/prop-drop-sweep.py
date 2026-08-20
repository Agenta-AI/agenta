#!/usr/bin/env python3
"""Find props that CALL SITES pass but the component never reads.

    python3 prop-drop-sweep.py                 # the known facades
    python3 prop-drop-sweep.py ChatBubble ...  # specific components

The bug it generalises is P-12: `EnhancedButton` listed `iconPosition="end"` under "Deferred
(rare / unused)" and destructured it into `_iconPosition` to keep it off the DOM node, so the
`EmptyState` Learn-More — which renders on all five Evaluations tabs and on Observability — drew
its arrow leading instead of trailing. `orphan-export-sweep.py` cannot see that: the symbol
exists, type-checks, and has consumers. It is the PROP that goes nowhere.

SELF-TESTED against that commit, both directions: on the pre-fix source it reports
`iconPosition  passed by 1 site(s): .../EmptyState.tsx`; on the fixed source it reports nothing.
Re-run that check if you change the matching — an earlier regex version passed neither.

WHAT IT CANNOT CATCH. Only props that are passed and never read. It is blind to a prop that is
read but rendered with the wrong metrics — C-01 (`ChatBubble` shrink-wrapping its avatar slot to
24px where antd-x reserves 32) reads `avatar` perfectly well, and this sweep calls it clean. That
class needs a measurement against the other build, not a grep.

Output is a TRIAGE LIST, not a verdict. Read every hit against the source before believing it: a
prop can be consumed via `...rest` (flagged inline when the file has one), forwarded under
another name, or deliberately accepted for API compatibility.
"""
import os
import re
import subprocess
import sys

WEB = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../web"))
ROOTS = ["oss/src", "ee/src", "packages"]
SKIP = re.compile(r"node_modules|/tests?/|\.test\.|\.stories\.|/storybook/|/dist/")

# Facades whose docstrings make an explicit parity or "unused" claim. Grep for the claims with:
#   grep -rniE "deferred \(|rare / unused|not forwarded|mirrors? antd" web/packages
DEFAULT = [
    "EnhancedButton", "EnhancedDrawer", "EnhancedModal", "ChatBubble",
    "InfiniteVirtualTableFeatureShell", "Accordion", "InputNumber",
    "SearchInput", "Select", "SplitPane", "EmptyState",
]

# Props every DOM/React element takes; never interesting.
BORING = {
    "key", "ref", "className", "style", "id", "children", "onClick", "onChange", "data-testid",
}


def files():
    out = []
    for root in ROOTS:
        base = os.path.join(WEB, root)
        for dirpath, _dirs, names in os.walk(base):
            if SKIP.search(dirpath + "/"):
                continue
            for n in names:
                if n.endswith((".tsx", ".ts")):
                    p = os.path.join(dirpath, n)
                    if not SKIP.search(p):
                        out.append(p)
    return out


def read(p):
    try:
        with open(p, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def resolve_specifier(spec, from_file):
    """A TS import specifier -> a real file, or None.

    Resolution has to be import-aware, not name-aware: several components share a name (there are
    three `EmptyState`s and two `Select`s), and matching by declaration attributed 25 call sites to
    a component that never sees them. Grouping by the module a call site actually imports from is
    what makes the output trustworthy.
    """
    if spec.startswith("."):
        base = os.path.normpath(os.path.join(os.path.dirname(from_file), spec))
    elif spec.startswith("@agenta/oss/src/"):
        base = os.path.join(WEB, "oss/src", spec[len("@agenta/oss/src/"):])
    elif spec.startswith("@/oss/"):
        base = os.path.join(WEB, "oss/src", spec[len("@/oss/"):])
    elif spec.startswith("@agenta/"):
        rest = spec[len("@agenta/"):]
        pkg, _, sub = rest.partition("/")
        base = os.path.join(WEB, "packages", f"agenta-{pkg}", "src", sub or "index")
    else:
        return None
    for cand in (base + ".tsx", base + ".ts",
                 os.path.join(base, "index.tsx"), os.path.join(base, "index.ts")):
        if os.path.isfile(cand):
            return cand
    return None


def importer_of(name, src, path):
    """Where THIS file imports `name` from, resolved to a file."""
    pat = re.compile(r"import\s+(?:type\s+)?(\{[^}]*\}|\w+)\s+from\s+[\"']([^\"']+)[\"']")
    for m in pat.finditer(src):
        clause, spec = m.group(1), m.group(2)
        if clause.startswith("{"):
            names = [n.split(" as ")[-1].strip() for n in clause.strip("{}").split(",")]
            if name not in [n for n in names if n]:
                continue
        elif clause.strip() != name:
            continue
        return resolve_specifier(spec, path)
    return None


def declares(src, name):
    return bool(re.search(rf"(?:export\s+)?(?:const|function|class)\s+{re.escape(name)}\b", src))


def follow_reexport(path, name, depth=3, seen=None):
    """A barrel `export {X} from "./X"` is not the definition — hop to the real one.

    `export *` needs every candidate tried, not just the first: taking the first one landed
    `EnhancedModal` on `InfiniteVirtualTable/columns/types.ts` and invented a whole group where
    13 call sites "passed a prop the component never reads". If no branch declares the name,
    return the barrel unchanged and let the caller see a boring result rather than a false one.
    """
    seen = seen or set()
    if not path or path in seen or depth <= 0:
        return path
    seen.add(path)
    src = read(path)
    if declares(src, name):
        return path
    m = re.search(rf"export\s*\{{[^}}]*\b{re.escape(name)}\b[^}}]*\}}\s*from\s+[\"']([^\"']+)[\"']", src)
    if m:
        nxt = resolve_specifier(m.group(1), path)
        if nxt:
            return follow_reexport(nxt, name, depth - 1, seen)
    for star in re.findall(r"export\s*\*\s*from\s+[\"']([^\"']+)[\"']", src):
        nxt = resolve_specifier(star, path)
        if not nxt or nxt in seen:
            continue
        got = follow_reexport(nxt, name, depth - 1, seen)
        if got and declares(read(got), name):
            return got
    return path


def opening_tags(name, src):
    """The attribute text of every `<Name ...>`, found by SCANNING, not by regex.

    A regex like `<Name[^>]*>` truncates at the first `>` — and `icon={<ArrowRight size={16} />}`
    contains one, so every prop AFTER a JSX-valued prop becomes invisible. That is exactly where
    `iconPosition` sits in `EmptyState`, so the regex version silently failed to reproduce the one
    bug this tool exists to catch. Track brace depth and quoting instead.
    """
    out = []
    start = 0
    tag = f"<{name}"
    while True:
        i = src.find(tag, start)
        if i < 0:
            return out
        j = i + len(tag)
        # `<Foo` must not be a prefix match of `<FooBar`.
        if j < len(src) and (src[j].isalnum() or src[j] in "_$"):
            start = j
            continue
        depth, quote, k = 0, None, j
        while k < len(src):
            c = src[k]
            if quote:
                if c == quote and src[k - 1] != "\\":
                    quote = None
            elif c in "\"'`":
                quote = c
            elif c in "{(":
                depth += 1
            elif c in "})":
                depth -= 1
            elif c == ">" and depth == 0:
                break
            k += 1
        out.append(src[j:k])
        start = k + 1


def attr_names(attrs):
    """Prop names declared at DEPTH 0 of an opening tag.

    Regexing every `name=` out of the attribute text also picks up the props of JSX nested inside
    a prop VALUE — `footer={<Button disabled loading aria-label="x"/>}` made `disabled`, `loading`
    and `aria-label` look like drawer props passed by eight call sites. Only names outside any
    `{}` belong to this component.
    """
    out, buf, depth, quote = [], "", 0, None
    i = 0
    while i < len(attrs):
        c = attrs[i]
        if quote:
            if c == quote and attrs[i - 1] != "\\":
                quote = None
        elif c in "\"'`":
            quote = c
        elif c in "{(":
            depth += 1
        elif c in "})":
            depth -= 1
        elif depth == 0:
            if c.isalnum() or c in "_-:$":
                buf += c
                i += 1
                continue
            if c == "=" and buf:
                out.append(buf)
            buf = ""
        if depth != 0 or quote:
            buf = ""
        i += 1
    return out


def call_sites_by_module(name, all_files):
    """{definition_file: {prop: [call sites]}} — grouped by what each site imports."""
    groups = {}
    for p in all_files:
        src = read(p)
        if f"<{name}" not in src:
            continue
        defn = importer_of(name, src, p)
        if defn:
            defn = follow_reexport(defn, name)
        # A barrel we could not resolve to a declaration is not a definition — reporting against
        # it produces confident nonsense, so drop the call site instead.
        if not defn or defn == p or not declares(read(defn), name):
            continue
        props = groups.setdefault(defn, {})
        for attrs in opening_tags(name, src):
            for prop in attr_names(attrs):
                if prop not in BORING:
                    props.setdefault(prop, set()).add(os.path.relpath(p, WEB))
    return {d: {k: sorted(v) for k, v in ps.items()} for d, ps in groups.items()}


def unread(prop, src):
    """True when the implementation never references `prop` outside its own declaration.

    Counts identifier occurrences, then discards the ones that prove nothing: the props-interface
    line (`prop?: X`), a rename-to-void destructure (`prop: _prop`), and the doc comments. What is
    left is a real read — a forward, a condition, a spread key.

    ALIASES. `classNames: customClassNames,` in a destructure is indistinguishable by shape from
    the interface line `classNames?: DrawerClassNamesProp` — both start `prop:`. Skipping both made
    the sweep re-report `classNames` as dropped AFTER it had been wired up, i.e. a false positive
    against its own fix. So when the alias target is a plain identifier (not a type and not a void
    `_name`), follow it: the prop is read iff the ALIAS is read.
    """
    alias = None
    for line in src.splitlines():
        m = re.match(rf"^\s*{re.escape(prop)}\s*:\s*([a-z][A-Za-z0-9_]*)\s*,\s*$", line)
        if m and not m.group(1).startswith("_"):
            alias = m.group(1)
            break
    if alias:
        return unread(alias, src)

    ident = re.compile(rf"\b{re.escape(prop)}\b")
    real = 0
    for line in src.splitlines():
        s = line.strip()
        if not ident.search(s):
            continue
        if s.startswith(("*", "//", "/*")):
            continue
        if re.match(rf"^{re.escape(prop)}\??\s*:", s):          # type declaration
            continue
        if re.search(rf"\b{re.escape(prop)}\s*:\s*_+\w*", s):    # destructured to a void name
            continue
        if re.match(rf"^{re.escape(prop)}\s*,?$", s):            # bare destructure line
            continue
        real += 1
    return real == 0


def has_rest_spread(src):
    """A `{...rest}` forward can consume a prop this sweep would otherwise call dropped."""
    return bool(re.search(r"\.\.\.(rest|props|others|restProps)\b", src))


def main(names):
    all_files = files()
    print(f"scanning {len(all_files)} files under web/{{{','.join(ROOTS)}}}\n")
    total = 0
    for name in names:
        groups = call_sites_by_module(name, all_files)
        if not groups:
            print(f"-- {name}: no resolvable call sites")
            continue
        for defn, props in sorted(groups.items(), key=lambda kv: -sum(len(v) for v in kv[1].values())):
            src = read(defn)
            rel = os.path.relpath(defn, WEB)
            drops = {p: f for p, f in props.items() if unread(p, src)}
            note = "  [has {...rest} — verify before believing]" if has_rest_spread(src) else ""
            if not drops:
                print(f"ok {name}: {len(props)} distinct props, all read  ({rel})")
                continue
            print(f"!! {name} ({rel}){note}")
            for p, fs in sorted(drops.items(), key=lambda kv: -len(kv[1])):
                total += 1
                print(f"     {p:<22} passed by {len(fs)} site(s): {', '.join(fs[:3])}"
                      + (" ..." if len(fs) > 3 else ""))
    print(f"\n{total} prop(s) to triage. Confirm each against the source, then in a browser.")


if __name__ == "__main__":
    main(sys.argv[1:] or DEFAULT)
