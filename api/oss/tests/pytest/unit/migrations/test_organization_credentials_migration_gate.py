"""The M5 revision passes the migration gate without the destructive label.

The only finding is the recovery `DROP INDEX CONCURRENTLY` of an invalid index left by an
interrupted build, which the gate reports and does not fail.
"""

import importlib.util
import sys
from pathlib import Path


_REPO = Path(__file__).resolve().parents[6]
_SCRIPT = _REPO / "api" / "scripts" / "migration_gate.py"
_REVISION = (
    _REPO
    / "api/oss/databases/postgres/migrations/core_oss/versions"
    / "oss000000054_add_organization_credentials.py"
)


def _gate():
    spec = importlib.util.spec_from_file_location("_migration_gate_m5", _SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_revision_passes_the_gate():
    gate = _gate()
    assert _REVISION.exists(), _REVISION
    findings = gate.scan_files([_REVISION])
    assert [f for f in findings if f.level == gate.CRITICAL] == []
    assert {f.operation for f in findings} <= {"execute(DROP INDEX)"}
