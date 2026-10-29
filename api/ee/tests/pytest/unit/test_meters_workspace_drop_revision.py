"""Revision `ee0000000009` (drop the workspace column of `meters`) without a database:
its place in the chain after the re-key and the fold, and the refusal that runs before
the drop."""

import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest

_VERSIONS = (
    Path(__file__).resolve().parents[3]
    / "databases"
    / "postgres"
    / "migrations"
    / "core_ee"
    / "versions"
)


def _load(name):
    path = _VERSIONS / name
    spec = importlib.util.spec_from_file_location(f"_revision_{path.stem}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _drop():
    return _load("ee0000000009_drop_meters_workspace_id.py")


class _Bind:
    """Answers the column check, then the row check."""

    def __init__(self, *, has_column, row):
        self.answers = [SimpleNamespace(meter_id="m") if has_column else None, row]
        self.statements = []

    def execute(self, statement, params=None):
        self.statements.append(str(statement))
        answer = self.answers.pop(0)
        return SimpleNamespace(first=lambda: answer)


def test_the_meter_revisions_chain():
    rekey = _load("ee0000000007_rekey_meters_without_workspace.py")
    fold = _load("ee0000000008_refold_meters_without_workspace.py")
    drop = _drop()
    assert (fold.revision, fold.down_revision) == ("ee0000000008", "ee0000000007")
    assert (drop.revision, drop.down_revision) == ("ee0000000009", "ee0000000008")
    assert fold._step_2_revision().revision == rekey.revision


def test_the_drop_refuses_a_row_that_still_has_a_workspace():
    drop = _drop()
    bind = _Bind(has_column=True, row=SimpleNamespace(meter_id="abc"))
    with pytest.raises(drop.RowWithWorkspace, match="abc"):
        drop.refuse_rows_with_a_workspace(bind)


def test_the_drop_passes_when_no_row_has_a_workspace():
    drop = _drop()
    bind = _Bind(has_column=True, row=None)
    drop.refuse_rows_with_a_workspace(bind)
    assert len(bind.statements) == 2


def test_the_drop_passes_when_the_column_is_already_gone():
    drop = _drop()
    bind = _Bind(has_column=False, row=None)
    drop.refuse_rows_with_a_workspace(bind)
    assert len(bind.statements) == 1
