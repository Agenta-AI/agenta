"""Workspace removal step 2b: no deployed code reads or writes the workspace storage.

Step 3 drops `workspaces`, `workspace_members`, `projects.workspace_id` and
`meters.workspace_id` while step-2b pods still serve. Any SQL or ORM mapping that names
one of them would fail on those pods, so none may exist in deployed code. Migrations
are exempt (they run before the drop), and so is the operator job
`entrypoints/memberships_check.py` (not deployed; step 3 removes its workspace checks).
"""

import re
from pathlib import Path

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.shared.dbas import ScopeDBA
from oss.src.models import db_models

_API = Path(__file__).resolve().parents[5]
_DEPLOYED = (_API / "oss" / "src", _API / "ee" / "src", _API / "entrypoints")
_EXEMPT = (
    _API / "entrypoints" / "memberships_check.py",
    _API / "oss" / "src" / "resources",
)

_PATTERNS = {
    "workspace_members table": re.compile(r"\bworkspace_members\b"),
    "workspaces table": re.compile(r"\b(from|join|into|update)\s+workspaces\b", re.I),
    "projects.workspace_id": re.compile(
        r"\b(p|projects|ProjectDB)\.workspace_id\b|INSERT INTO projects\s*\([^)]*workspace_id",
        re.S,
    ),
    "meters.workspace_id": re.compile(r"\b(meters|MeterDBE)\.workspace_id\b"),
    "workspace models": re.compile(
        r"\b(WorkspaceDB|WorkspaceMemberDB|WorkspaceScopeDBA)\b"
    ),
}


def _deployed_files():
    for root in _DEPLOYED:
        for path in root.rglob("*.py"):
            if any(path == exempt or exempt in path.parents for exempt in _EXEMPT):
                continue
            yield path


def test_no_deployed_code_names_the_workspace_storage():
    found = []
    for path in _deployed_files():
        source = path.read_text()
        for name, pattern in _PATTERNS.items():
            for match in pattern.finditer(source):
                line = source.count("\n", 0, match.start()) + 1
                found.append(f"{path.relative_to(_API)}:{line} {name}")
    assert found == []


def test_the_orm_maps_no_workspace_table_or_column():
    assert "workspaces" not in Base.metadata.tables
    assert "workspace_members" not in Base.metadata.tables
    assert "workspace_id" not in db_models.ProjectDB.__table__.columns
    assert not hasattr(db_models, "WorkspaceDB")
    assert not hasattr(db_models, "WorkspaceMemberDB")
    assert not hasattr(ScopeDBA, "workspace_id")
