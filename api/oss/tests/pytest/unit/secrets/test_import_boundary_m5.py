"""Import boundary of the M5 core modules: no web framework, no legacy db_manager, no
models module, no EE code (api/AGENTS.md layering)."""

import ast
from pathlib import Path

_API = Path(__file__).resolve().parents[5]
# Every core/secrets module but `utils.py`, a legacy helper with no caller that predates
# M5 (it builds the service from the DAO itself).
_MODULES = [
    *sorted(
        p for p in (_API / "oss/src/core/secrets").glob("*.py") if p.name != "utils.py"
    ),
    _API / "oss/src/core/access/organizations.py",
]
_FORBIDDEN = ("fastapi", "oss.src.services.db_manager", "oss.src.models", "ee")


def _imports(path: Path):
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield alias.name
        elif isinstance(node, ast.ImportFrom) and node.module:
            yield node.module


def test_core_secrets_and_organization_decision_import_boundary():
    offenders = []
    for path in _MODULES:
        for name in _imports(path):
            if any(name == f or name.startswith(f + ".") for f in _FORBIDDEN):
                offenders.append(f"{path.relative_to(_API)}: {name}")
    assert offenders == []
