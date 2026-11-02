"""The new access and memberships core imports no db_manager, no ORM models, no EE."""

import ast
from pathlib import Path

import pytest


_API = Path(__file__).resolve().parents[5]
_BOUNDARY = [
    *sorted((_API / "oss/src/core/memberships").glob("*.py")),
    *[
        _API / "oss/src/core/access" / name
        for name in ("dtos.py", "types.py", "interfaces.py", "rbac.py", "service.py")
    ],
]
_FORBIDDEN = ("oss.src.services.db_manager", "oss.src.models", "ee")


def _imports(path: Path):
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield alias.name
        elif isinstance(node, ast.ImportFrom) and node.module:
            yield node.module
            if node.module == "oss.src.services":
                for alias in node.names:
                    yield f"oss.src.services.{alias.name}"


@pytest.mark.parametrize("path", _BOUNDARY, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_new_access_core_imports_no_db_manager_models_or_ee(path):
    assert path.exists()
    bad = [
        name
        for name in _imports(path)
        if any(name == f or name.startswith(f + ".") for f in _FORBIDDEN)
    ]
    assert bad == []
