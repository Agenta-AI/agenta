#!/usr/bin/env python3
"""
Compare dependency versions:

- constraint: from pyproject.toml
- locked    : from poetry.lock
- latest    : from `poetry show --latest`

Usage:
    python check_deps.py
"""

from __future__ import annotations

import subprocess
from pathlib import Path

try:
    import tomllib  # Python 3.11+
except ImportError:  # pragma: no cover
    import tomli as tomllib  # type: ignore[no-redef]


GREEN = "\033[32m"
YELLOW = "\033[33m"
ORANGE = "\033[38;5;214m"
RED = "\033[31m"
RESET = "\033[0m"


def version_tuple(v: str) -> tuple[int, ...]:
    parts = []
    for p in v.split(".")[:3]:
        try:
            parts.append(int(p))
        except ValueError:
            parts.append(0)
    return tuple(parts)


def colorize(line: str, locked: str, latest: str) -> str:
    if not locked or not latest:
        return line
    lv = version_tuple(locked)
    rv = version_tuple(latest)
    if lv == rv:
        color = GREEN
    elif lv[0] != rv[0]:
        color = RED
    elif lv[1] != rv[1]:
        color = ORANGE
    else:
        color = YELLOW
    return f"{color}{line}{RESET}"


ROOT = Path(__file__).resolve().parent
PYPROJECT = ROOT / "pyproject.toml"
LOCKFILE = ROOT / "poetry.lock"


def load_pyproject_constraints() -> dict[str, str]:
    """
    Read [tool.poetry.dependencies] constraints from pyproject.toml.
    (Only runtime deps; you can extend to include groups if you want.)
    """
    data = tomllib.loads(PYPROJECT.read_text())
    tool = data.get("tool", {})
    poetry = tool.get("poetry", {})

    constraints: dict[str, str] = {}

    for section in ("dependencies",):
        for name, spec in poetry.get(section, {}).items():
            if name == "python":
                continue
            name_lower = name.lower()

            if isinstance(spec, str):
                constraints[name_lower] = spec
            elif isinstance(spec, dict) and "version" in spec:
                constraints[name_lower] = str(spec["version"])
            else:
                # Fallback: store whatever is there as string
                constraints[name_lower] = str(spec)

    return constraints


def load_locked_versions() -> dict[str, str]:
    """
    Read package versions from poetry.lock.
    """
    data = tomllib.loads(LOCKFILE.read_text())
    pkgs = data.get("package", [])
    return {pkg["name"].lower(): pkg["version"] for pkg in pkgs}


def load_poetry_latest() -> dict[str, tuple[str, str]]:
    """
    Use `poetry show --latest` and parse lines like:

        fastapi  0.122.0  0.122.0  FastAPI framework, ...

    Returns a mapping: name -> (current, latest)
    """
    result = subprocess.run(
        ["poetry", "show", "--latest"],
        capture_output=True,
        text=True,
        check=True,
    )

    latest: dict[str, tuple[str, str]] = {}

    for line in result.stdout.splitlines():
        line = line.strip()
        if not line or " " not in line:
            continue

        parts = line.split()
        if len(parts) < 3:
            continue

        name = parts[0].lower()
        current = parts[1]
        newest = parts[2]
        latest[name] = (current, newest)

    return latest


def main() -> None:
    constraints = load_pyproject_constraints()
    locked = load_locked_versions()
    poetry_latest = load_poetry_latest()

    # Dynamic column widths based on content
    col1 = max(len("package"), *(len(name) for name in constraints.keys())) + 2
    col2 = (
        max(
            len("constraint"),
            *(len(str(c)) for c in constraints.values()),
        )
        + 2
    )

    header = (
        f"{'package':{col1}} {'constraint':{col2}} {'locked':12} {'pypi-latest':12}"
    )
    print(header)
    print("-" * len(header))

    # Only show packages that are direct runtime deps in pyproject
    for name in sorted(constraints.keys()):
        constraint = constraints.get(name, "")
        locked_version = locked.get(name, "")

        current, latest = poetry_latest.get(name, ("", ""))

        # Prefer lockfile version; fall back to poetry's current if missing
        if not locked_version:
            locked_version = current

        line = f"{name:{col1}} {constraint:{col2}} {locked_version:12} {latest:12}"
        print(colorize(line, locked_version, latest))


if __name__ == "__main__":
    main()
