#!/usr/bin/env python3
"""Regenerate api_routers_and_endpoints.md.

Walks every FastAPI router under application/api/, extracts
(path, method, operation_id, handler) for each route, and cross-references
the operation_id against the Fern-generated TypeScript and Python clients.

Run from anywhere:
    python application/docs/openapi-cleanup/generate.py
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

# Resolve repo paths relative to this script so it works from any CWD.
HERE = Path(__file__).resolve()
APP = HERE.parents[2]  # application/
API_ROOT = APP / "api"
TS_RES = APP / "web/packages/agenta-api-client/src/generated/api/resources"
PY_ROOT = APP / "clients/python/agenta_client"
OUT_PATH = APP / "docs/openapi-cleanup/endpoints.md"

ROUTER_GLOBS = [
    API_ROOT / "oss/src/apis/fastapi",  # */router.py
    API_ROOT / "ee/src/apis/fastapi",  # */router.py
    API_ROOT / "oss/src/routers",  # *.py (legacy)
]

# Files that mount routers onto the FastAPI app via `app.include_router(...)`.
MOUNT_FILES = [
    API_ROOT / "entrypoints/routers.py",
    API_ROOT / "ee/src/main.py",
]


def find_router_files() -> list[Path]:
    files: list[Path] = []
    files.extend(sorted((API_ROOT / "oss/src/apis/fastapi").glob("*/router.py")))
    files.extend(sorted((API_ROOT / "ee/src/apis/fastapi").glob("*/router.py")))
    for p in sorted((API_ROOT / "oss/src/routers").glob("*.py")):
        if p.name.startswith("__"):
            continue
        files.append(p)
    return files


def rel_source(path: Path) -> str:
    return str(path.relative_to(API_ROOT))


def _const(node: ast.AST) -> object | None:
    return node.value if isinstance(node, ast.Constant) else None


def _enclosing_class(tree: ast.AST, target: ast.AST) -> str | None:
    """Return the name of the ClassDef that lexically contains `target`, if any."""
    for cls in ast.walk(tree):
        if isinstance(cls, ast.ClassDef):
            for sub in ast.walk(cls):
                if sub is target:
                    return cls.name
    return None


def extract_routes(path: Path):
    """Yield route dicts from a router file.

    Handles two patterns:
    * `self.<name>_router.add_api_route(path, endpoint=..., methods=[...], operation_id=...)`
      and `self.router.add_api_route(...)`
    * `@router.<method>(path, operation_id=...)` decorators on functions

    The yielded `class_name` is the enclosing `ClassDef` (or `None` for module-level
    decorator routes); it is used to attribute mount prefixes to the right class
    when a single file defines multiple router classes.
    """
    src = path.read_text()
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return
    source = rel_source(path)

    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "add_api_route"
        ):
            kwargs = {kw.arg: kw.value for kw in node.keywords}
            pth = None
            if node.args and isinstance(node.args[0], ast.Constant):
                pth = node.args[0].value
            if pth is None and "path" in kwargs:
                pth = _const(kwargs["path"])
            methods: list[str] = []
            mnode = kwargs.get("methods")
            if isinstance(mnode, ast.List):
                for el in mnode.elts:
                    v = _const(el)
                    if isinstance(v, str):
                        methods.append(v)
            op_id = (
                _const(kwargs.get("operation_id")) if "operation_id" in kwargs else None
            )
            handler = None
            ep = kwargs.get("endpoint")
            if isinstance(ep, ast.Attribute):
                handler = ep.attr
            elif isinstance(ep, ast.Name):
                handler = ep.id
            class_name = _enclosing_class(tree, node)
            if isinstance(pth, str) and methods:
                for method_idx, m in enumerate(methods):
                    yield {
                        "source": source,
                        "class_name": class_name,
                        "method": m.upper(),
                        "path": pth,
                        "operation_id": op_id if isinstance(op_id, str) else None,
                        "handler": handler,
                        # Route order within its source file. Mirrors the order
                        # FastAPI registers routes when the class's __init__ runs.
                        "source_line": node.lineno,
                        "method_idx": method_idx,
                    }

        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for dec in node.decorator_list:
                if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute):
                    method = dec.func.attr.upper()
                    if method not in {"GET", "POST", "PUT", "DELETE", "PATCH"}:
                        continue
                    pth = None
                    if dec.args and isinstance(dec.args[0], ast.Constant):
                        pth = dec.args[0].value
                    op_id = None
                    for kw in dec.keywords:
                        if kw.arg == "operation_id":
                            v = _const(kw.value)
                            if isinstance(v, str):
                                op_id = v
                    if isinstance(pth, str):
                        yield {
                            "source": source,
                            "class_name": _enclosing_class(tree, node),
                            "method": method,
                            "path": pth,
                            "operation_id": op_id or node.name,
                            "handler": node.name,
                            "source_line": dec.lineno,
                            "method_idx": 0,
                        }


def _module_to_relpath(dotted: str) -> str:
    """Convert a dotted module name (e.g. `oss.src.apis.fastapi.vault.router`)
    to the relative path used in the doc (e.g. `oss/src/apis/fastapi/vault/router.py`).
    """
    return dotted.replace(".", "/") + ".py"


def _resolve_import_relpath(module: str, alias: str) -> str | None:
    """Given `from {module} import {alias}`, return the source-file relpath.

    Tries two shapes:
    * `{module}/{alias}.py` — `from oss.src.routers import permissions_router`
      (alias is a submodule).
    * `{module}.py` — `from oss.src.apis.fastapi.vault.router import VaultRouter`
      (alias is a name defined inside that module).

    Returns the first path that actually exists under `API_ROOT`, else `None`.
    """
    submodule = (module.replace(".", "/") + "/" + alias) + ".py"
    sibling = _module_to_relpath(module)
    for candidate in (submodule, sibling):
        if (API_ROOT / candidate).exists():
            return candidate
    return None


def collect_mount_prefixes() -> dict[tuple[str, str | None], dict]:
    """Return a map of `(router-source-relpath, class_name)` → mount info.

    Each value is `{"prefixes": [...], "order": <int>}`:
    * `prefixes` is the list of `prefix=` strings from every public mount
      (skipping `include_in_schema=False`).
    * `order` is a global integer encoding the position of the *first*
      public `include_router` call across all mount files — used to sort
      routes in OpenAPI document order rather than alphabetically.

    Walks `entrypoints/routers.py` and `ee/src/main.py`, collects every
    `app.include_router(router=<expr>, prefix="...", ...)` call, and
    resolves `<expr>` back to the source file *and* the specific router
    class that defines it. Several files (e.g. `evaluations/router.py`)
    declare multiple router classes in a single module — without the class
    qualifier, mounts from one class would bleed onto routes from another.

    `class_name` is `None` for module-level routers (e.g. the `auth_router`
    instance in `auth/router.py`) and matches `_enclosing_class` for
    class-defined routes.
    """
    # name -> (source relpath, class_name | None).
    #   `from <module> import Name`            → (module_relpath, None) — for module-level routers
    #   `name = SomeRouterClass(...)`         → (class's source, "SomeRouterClass")
    out: dict[tuple[str, str | None], dict] = {}
    # Ascending counter so the first include_router call encountered (across
    # both mount files in their listing order) gets the lowest order.
    order_counter = 0

    for f in MOUNT_FILES:
        if not f.exists():
            continue
        try:
            tree = ast.parse(f.read_text())
        except SyntaxError:
            continue

        names_to_source: dict[str, tuple[str, str | None]] = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                for alias in node.names:
                    local = alias.asname or alias.name
                    relpath = _resolve_import_relpath(node.module, alias.name)
                    if relpath is None:
                        continue
                    # Imported name might be a class (e.g. `EvaluationsRouter`)
                    # or a module-level router instance (e.g. `auth_router`).
                    # Distinguish by case: a class starts with an uppercase letter.
                    is_class = alias.name[:1].isupper() if alias.name else False
                    names_to_source[local] = (
                        relpath,
                        alias.name if is_class else None,
                    )
            if isinstance(node, ast.Assign) and len(node.targets) == 1:
                tgt = node.targets[0]
                if isinstance(tgt, ast.Name) and isinstance(node.value, ast.Call):
                    func = node.value.func
                    if isinstance(func, ast.Name) and func.id in names_to_source:
                        # Inherit the (source, class) pair from the called class.
                        names_to_source[tgt.id] = names_to_source[func.id]

        # Collect include_router calls in source order so the global counter
        # increments deterministically.
        calls: list[ast.Call] = []
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "include_router"
            ):
                calls.append(node)
        calls.sort(key=lambda c: c.lineno)

        for node in calls:
            kwargs = {kw.arg: kw.value for kw in node.keywords}
            router_expr = kwargs.get("router")
            if router_expr is None and node.args:
                router_expr = node.args[0]
            in_schema = kwargs.get("include_in_schema")
            if isinstance(in_schema, ast.Constant) and in_schema.value is False:
                continue
            prefix_node = kwargs.get("prefix")
            prefix = prefix_node.value if isinstance(prefix_node, ast.Constant) else ""
            name = None
            if isinstance(router_expr, ast.Name):
                name = router_expr.id
            elif isinstance(router_expr, ast.Attribute) and isinstance(
                router_expr.value, ast.Name
            ):
                name = router_expr.value.id
            if name and name in names_to_source:
                key = names_to_source[name]
                entry = out.setdefault(key, {"prefixes": [], "order": order_counter})
                entry["prefixes"].append(prefix)
                order_counter += 1

    return out


def collect_ts_methods() -> dict[str, set[str]]:
    """resource_dir -> set of camelCase public method names."""
    out: dict[str, set[str]] = {}
    if not TS_RES.exists():
        return out
    for d in sorted(TS_RES.iterdir()):
        if not d.is_dir():
            continue
        client_file = d / "client" / "Client.ts"
        if not client_file.exists():
            continue
        text = client_file.read_text()
        names = set(re.findall(r"^\s+public\s+(\w+)\s*\(", text, re.M))
        out[d.name] = names
    return out


def collect_py_methods() -> dict[str, set[str]]:
    """resource_dir -> set of snake_case method names."""
    out: dict[str, set[str]] = {}
    if not PY_ROOT.exists():
        return out
    for d in sorted(PY_ROOT.iterdir()):
        if not d.is_dir():
            continue
        client_file = d / "client.py"
        if not client_file.exists():
            continue
        text = client_file.read_text()
        names = set(re.findall(r"^    def\s+(\w+)\s*\(", text, re.M))
        names = {n for n in names if not n.startswith("_") and n != "with_raw_response"}
        out[d.name] = names
    return out


def snake_to_camel(s: str) -> str:
    parts = s.split("_")
    return parts[0] + "".join(p[:1].upper() + p[1:] for p in parts[1:])


def find_ts(op_id: str | None, ts: dict[str, set[str]]):
    if not op_id:
        return None
    cam = snake_to_camel(op_id)
    for resource, methods in ts.items():
        if cam in methods:
            return resource, cam
    return None


def find_py(op_id: str | None, py: dict[str, set[str]]):
    if not op_id:
        return None
    for resource, methods in py.items():
        if op_id in methods:
            return resource, op_id
    return None


def _full_path(prefix: str, route_path: str) -> str:
    """Join an `include_router` prefix with a route path, normalizing slashes."""
    p = (prefix or "").rstrip("/")
    if not route_path:
        return p or "/"
    if route_path == "/":
        # Trailing slash is significant (FastAPI strips it when prefix is empty);
        # preserve it when there is a prefix.
        return f"{p}/" if p else "/"
    if not route_path.startswith("/"):
        route_path = "/" + route_path
    return f"{p}{route_path}"


def main() -> int:
    routes = []
    for f in find_router_files():
        routes.extend(extract_routes(f))

    ts = collect_ts_methods()
    py = collect_py_methods()
    mount_prefixes = collect_mount_prefixes()

    # Resolve each route's full path (prefix + path). Look up by
    # (source, class) so routes from a `EvaluationsRouter` class don't pick
    # up the mount prefix of a sibling `SimpleEvaluationsRouter` defined in
    # the same module. Module-level routers (e.g. `auth_router`) match the
    # `(source, None)` key.
    UNMOUNTED_ORDER = 10**9  # push routes from never-mounted routers to the end
    for r in routes:
        key = (r["source"], r["class_name"])
        info = mount_prefixes.get(key)
        if not info:
            r["full_paths"] = [r["path"]]
            r["mount_order"] = UNMOUNTED_ORDER
        else:
            seen: list[str] = []
            for prefix in info["prefixes"]:
                fp = _full_path(prefix, r["path"])
                if fp not in seen:
                    seen.append(fp)
            r["full_paths"] = seen
            r["mount_order"] = info["order"]

    # Sort to mirror OpenAPI document order: routers appear in the order
    # they are mounted in entrypoints/routers.py + ee/src/main.py, then
    # routes within a router appear in their source-file order, then the
    # original methods=[...] list order is preserved per add_api_route.
    routes.sort(
        key=lambda r: (
            r["mount_order"],
            r["source"],
            r["source_line"],
            r["method_idx"],
        )
    )

    mapped_rows: list[str] = []
    unmapped_rows: list[str] = []
    for r in routes:
        op_id = r["operation_id"] or ""
        ts_hit = find_ts(op_id, ts)
        py_hit = find_py(op_id, py)
        handler_cell = (r["handler"] + "()") if r["handler"] else "-"
        # `<br>` keeps multi-mount paths readable in rendered Markdown; a
        # bare `|` would close the table cell.
        path_cell = "<br>".join(f"`{p}`" for p in r["full_paths"])
        if ts_hit or py_hit:
            ts_cell = f"client.{ts_hit[0]}.{ts_hit[1]}()" if ts_hit else "-"
            py_cell = f"client.{py_hit[0]}.{py_hit[1]}()" if py_hit else "-"
            mapped_rows.append(
                f"| `{r['source']}` | `{r['method']}` | {path_cell} | "
                f"`{op_id}` | `{ts_cell}` | `{py_cell}` | `{handler_cell}` |"
            )
        else:
            unmapped_rows.append(
                f"| `{r['source']}` | `{r['method']}` | {path_cell} | "
                f"`{op_id}` | `{handler_cell}` |"
            )

    total = len(routes)
    lines: list[str] = [
        "# API Routers and Endpoints",
        "",
        "Generated by `application/docs/openapi-cleanup/generate.py`.",
        "",
        "Each row is a static FastAPI route discovered under `application/api/`. "
        "Routes are looked up in the Fern-generated clients "
        "(`application/clients/python/agenta_client` and "
        "`application/web/packages/agenta-api-client`) by `operation_id` and split "
        "into two tables below.",
        "",
        f"- **Mapped:** {len(mapped_rows)}/{total} — exposed in at least one generated client.",
        f"- **Unmapped:** {len(unmapped_rows)}/{total} — not exposed in either generated client (admin-tagged routes are intentionally stripped by `clients/scripts/generate.sh`; other unmapped rows are internal-only or tagged out of the public OpenAPI).",
        "",
        "## Mapped routes",
        "",
        "| Source | Method | Path | operation_id | TS usage | Python usage | Handler |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        *mapped_rows,
        "",
        "## Unmapped routes",
        "",
        "| Source | Method | Path | operation_id | Handler |",
        "| --- | --- | --- | --- | --- |",
        *unmapped_rows,
    ]

    OUT_PATH.write_text("\n".join(lines) + "\n")

    ts_hits = sum(1 for r in routes if find_ts(r["operation_id"], ts))
    py_hits = sum(1 for r in routes if find_py(r["operation_id"], py))
    print(f"routes:    {len(routes)}", file=sys.stderr)
    print(f"ts hits:   {ts_hits}/{len(routes)}", file=sys.stderr)
    print(f"py hits:   {py_hits}/{len(routes)}", file=sys.stderr)
    print(f"wrote:     {OUT_PATH}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
