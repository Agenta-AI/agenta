"""Revision `oss000000056` (workspace removal step 3) without a database: its place in
the chain after the step 2 and step 2b revisions, and the refusal that runs before any
drop."""

from types import SimpleNamespace

import pytest

from oss.tests.pytest.utils.membership_seed import load_revision_module

_DROP = "oss000000056_drop_workspaces.py"


class _Bind:
    def __init__(self, rows):
        self.rows = rows
        self.statements = []

    def execute(self, statement, params=None):
        self.statements.append(str(statement))
        return SimpleNamespace(fetchall=lambda: self.rows)


def test_the_workspace_removal_revisions_chain():
    switch = load_revision_module(
        "oss000000053_switch_projects_to_organization_defaults.py"
    )
    rerun = load_revision_module("oss000000055_rerun_organization_defaults.py")
    drop = load_revision_module(_DROP)
    assert (rerun.revision, rerun.down_revision) == ("oss000000055", "oss000000053")
    assert (drop.revision, drop.down_revision) == ("oss000000056", "oss000000055")
    assert rerun._step_2_revision().revision == switch.revision


def test_the_drop_refuses_a_foreign_key_from_another_table():
    drop = load_revision_module(_DROP)
    bind = _Bind([SimpleNamespace(table_name="custom", conname="custom_workspace_fk")])
    with pytest.raises(drop.OutsideReference, match="custom.custom_workspace_fk"):
        drop.refuse_outside_references(bind)


def test_the_drop_passes_without_outside_references():
    drop = load_revision_module(_DROP)
    bind = _Bind([])
    drop.refuse_outside_references(bind)
    assert len(bind.statements) == 1
