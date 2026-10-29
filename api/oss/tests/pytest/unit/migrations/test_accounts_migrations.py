"""The accounts revisions (055 to 059): one chain after main's head, and no destructive
operation in an upgrade path. The warnings are the index and primary key swaps, which
build the new index or key before the old one goes."""

import ast
import importlib.util
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[6]
_SCRIPT = _REPO / "api" / "scripts" / "migration_gate.py"
_VERSIONS = _REPO / "api/oss/databases/postgres/migrations/core_oss/versions"
_CHAIN = [
    ("oss000000055_add_mcp_token_secret_kind.py", "oss000000053"),
    ("oss000000056_add_personal_secrets.py", "oss000000055"),
    ("oss000000057_add_personal_gateway_connections.py", "oss000000056"),
    ("oss000000058_add_account_choices.py", "oss000000057"),
    ("oss000000059_add_mcps_oauth_attempts_owner_kind.py", "oss000000058"),
]


def _gate():
    spec = importlib.util.spec_from_file_location("_migration_gate_accounts", _SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _down_revision(path: Path) -> str:
    for node in ast.parse(path.read_text()).body:
        if isinstance(node, ast.AnnAssign) and getattr(node.target, "id", "") == (
            "down_revision"
        ):
            return node.value.value
    raise AssertionError(f"{path.name} has no down_revision")


def test_the_revisions_chain_after_mains_head():
    for name, down in _CHAIN:
        assert _down_revision(_VERSIONS / name) == down, name


def test_the_revisions_pass_the_gate():
    gate = _gate()
    findings = gate.scan_files([_VERSIONS / name for name, _ in _CHAIN])
    assert [f for f in findings if f.level == gate.CRITICAL] == []
    assert {f.operation for f in findings} <= {
        "execute(DROP INDEX)",
        "execute(ALTER TABLE DROP CONSTRAINT)",
    }
