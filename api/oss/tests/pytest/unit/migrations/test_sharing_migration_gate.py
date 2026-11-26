"""The two sharing revisions pass the migration gate with no finding.

The gate runs in CI on every revision; a CRITICAL finding fails the check until a
reviewer applies the approval label. The sharing schema is additive, so neither revision
may need the label, and neither may carry a warning either.
"""

import importlib.util
import sys
from pathlib import Path

import pytest


_REPO = Path(__file__).resolve().parents[6]
_SCRIPT = _REPO / "api" / "scripts" / "migration_gate.py"
_VERSIONS = (
    _REPO
    / "api"
    / "oss"
    / "databases"
    / "postgres"
    / "migrations"
    / "core_oss"
    / "versions"
)


def _load_gate():
    spec = importlib.util.spec_from_file_location("_sharing_migration_gate", _SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


# The schema revision and, once it exists, the backfill revision. A missing backfill
# file fails its own integration tests, so the glob cannot hide it.
_SHARING_REVISIONS = sorted(
    path.name
    for prefix in ("oss000000048_", "oss000000049_")
    for path in _VERSIONS.glob(f"{prefix}*.py")
)


def test_the_schema_revision_is_scanned():
    assert "oss000000048_add_agent_session_sharing.py" in _SHARING_REVISIONS


@pytest.mark.parametrize("name", _SHARING_REVISIONS)
def test_revisions_pass_gate(name):
    gate = _load_gate()
    path = _VERSIONS / name
    assert gate.scan_source(path.read_text(), str(path)) == []
    assert gate.main([str(path)]) == 0
