#!/usr/bin/env python3
"""
Compare dependency versions:

- constraint: from pyproject.toml
- locked    : from uv.lock
- latest    : from PyPI

Usage:
    python check_deps.py
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
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
LOCKFILE = ROOT / "uv.lock"


def load_pyproject_constraints() -> dict[str, str]:
    """
    Read [project.dependencies] constraints from pyproject.toml.
    (Only runtime deps; you can extend to include groups if you want.)
    """
    data = tomllib.loads(PYPROJECT.read_text())

    constraints: dict[str, str] = {}

    for spec in data.get("project", {}).get("dependencies", []):
        name = spec.split(";", 1)[0].split("[", 1)[0]
        for separator in ("<", ">", "=", "!", "~"):
            name = name.split(separator, 1)[0]
        name = name.strip().lower()
        if name:
            constraints[name] = spec

    return constraints


def load_locked_versions() -> dict[str, str]:
    """
    Read package versions from uv.lock.
    """
    data = tomllib.loads(LOCKFILE.read_text())
    pkgs = data.get("package", [])

    locked: dict[str, str] = {}
    for pkg in pkgs:
        name = pkg["name"].lower()
        locked[name] = pkg["version"]
    return locked


def load_pypi_latest(package_names: list[str]) -> dict[str, str]:
    latest: dict[str, str] = {}

    for name in package_names:
        try:
            with urllib.request.urlopen(
                f"https://pypi.org/pypi/{name}/json", timeout=10
            ) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError):
            continue
        version = payload.get("info", {}).get("version")
        if not version:
            continue
        latest[name] = version

    return latest


def main() -> None:
    constraints = load_pyproject_constraints()
    locked = load_locked_versions()
    pypi_latest = load_pypi_latest(sorted(constraints.keys()))

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

        latest = pypi_latest.get(name, "")

        line = f"{name:{col1}} {constraint:{col2}} {locked_version:12} {latest:12}"
        print(colorize(line, locked_version, latest))


if __name__ == "__main__":
    main()
