"""Revision `oss000000056` (workspace removal step 3) without a database: its place in
the chain after the step 2 and step 2b revisions."""

from oss.tests.pytest.utils.membership_seed import load_revision_module


def test_the_workspace_removal_revisions_chain():
    switch = load_revision_module(
        "oss000000053_switch_projects_to_organization_defaults.py"
    )
    rerun = load_revision_module("oss000000055_rerun_organization_defaults.py")
    drop = load_revision_module("oss000000056_drop_workspaces.py")
    assert (rerun.revision, rerun.down_revision) == ("oss000000055", "oss000000053")
    assert (drop.revision, drop.down_revision) == ("oss000000056", "oss000000055")
    assert rerun._step_2_revision().revision == switch.revision
