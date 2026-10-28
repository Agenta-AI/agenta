"""No code names the workspace storage that workspace removal dropped.

Step 3 dropped `workspaces`, `workspace_members`, `projects.workspace_id` and
`meters.workspace_id`. Any SQL or ORM mapping that names one of them fails at run time,
so none may exist in the API code, the operator jobs or the tests. Migrations are exempt
(the older revisions run before the drop), and so is the test of the drop revision.
"""

import re
from pathlib import Path

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.shared.dbas import ScopeDBA
from oss.src.models import db_models
from oss.src.services import db_manager

_API = Path(__file__).resolve().parents[5]
_SCANNED = (
    _API / "oss" / "src",
    _API / "ee" / "src",
    _API / "entrypoints",
    _API / "oss" / "tests",
    _API / "ee" / "tests",
)
_EXEMPT = (
    _API / "oss" / "src" / "resources",
    # The pre-pytest test suite, kept for reference and never run.
    _API / "oss" / "tests" / "legacy",
    Path(__file__).resolve(),
    _API / "oss/tests/pytest/integration/memberships/test_workspace_drop_postgres.py",
)

_PATTERNS = {
    "workspace_members table": re.compile(r"\bworkspace_members\b"),
    "workspaces table": re.compile(r"\b(from|join|into|update)\s+workspaces\b", re.I),
    "projects.workspace_id": re.compile(
        r"\b(p|projects|ProjectDB)\.workspace_id\b|INSERT INTO projects\s*\([^)]*workspace_id",
        re.S,
    ),
    "meters.workspace_id": re.compile(r"\b(meters|MeterDBE)\.workspace_id\b"),
    # A wildcard over `projects` reads `workspace_id` while the column exists.
    "projects wildcard": re.compile(
        r"\bp\.\*|(UPDATE|INSERT INTO|FROM) projects\b[^\"]*?RETURNING \*", re.S
    ),
    "workspace models": re.compile(
        r"\b(WorkspaceDB|WorkspaceMemberDB|WorkspaceScopeDBA)\b"
    ),
}


def _scanned_files():
    for root in _SCANNED:
        for path in root.rglob("*.py"):
            if any(path == exempt or exempt in path.parents for exempt in _EXEMPT):
                continue
            yield path


def test_no_code_names_the_workspace_storage():
    found = []
    for path in _scanned_files():
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


def test_explicit_project_columns_are_the_mapped_ones():
    mapped = {column.name for column in db_models.ProjectDB.__table__.columns}
    assert set(db_manager._PROJECT_COLUMNS.split(", ")) == mapped
