"""`oss/src/core/sharing` stays a core domain: no db_manager, no legacy models, no EE
code, no FastAPI."""

import ast
from pathlib import Path

import oss.src.core.sharing as sharing_package


_FORBIDDEN = ("oss.src.services.db_manager", "oss.src.models", "ee", "fastapi")


def _imports(path: Path):
    tree = ast.parse(path.read_text(), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield alias.name
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            yield node.module


def _forbidden(name: str) -> bool:
    return any(name == prefix or name.startswith(prefix + ".") for prefix in _FORBIDDEN)


def test_sharing_core_imports_no_db_manager_models_ee_or_fastapi():
    root = Path(sharing_package.__file__).parent
    files = sorted(root.rglob("*.py"))
    assert files
    offenders = [
        (str(path.relative_to(root)), name)
        for path in files
        for name in _imports(path)
        if _forbidden(name)
    ]
    assert offenders == []
