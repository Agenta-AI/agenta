"""The migration gate flags a destructive revision and lets an approved one through.

A deploy runs `alembic upgrade head` in a Helm pre-upgrade hook, before any new pod
starts, and the api runs two replicas with `maxUnavailable=0`. The old code runs
against the new schema for the length of every rollout, and the database does not
roll back when the deploy does. The gate is the only thing that makes such a change
visible to a reviewer, so a gate that silently stops flagging is worse than no gate.

These drive the script the CI job runs, through its command line, so that a change
to the output or to an exit code shows up here.
"""

import importlib.util
import json
import sys
from pathlib import Path

import pytest


_REPO = Path(__file__).resolve().parents[6]
_SCRIPT = _REPO / "api" / "scripts" / "migration_gate.py"
_VERSIONS_GLOB = "api/*/databases/postgres/migrations/*/versions/*.py"


def _load():
    assert _SCRIPT.exists(), f"no migration gate at {_SCRIPT}"
    spec = importlib.util.spec_from_file_location("_migration_gate", _SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


gate = _load()


HEADER = '''"""A revision.

Revision ID: abc123
Revises: def456
"""

import sqlalchemy as sa
from alembic import op

revision = "abc123"
down_revision = "def456"

'''


def _revision(tmp_path: Path, upgrade: str, downgrade: str = "    pass") -> Path:
    path = tmp_path / "abc123_a_revision.py"
    path.write_text(
        f"{HEADER}\n\ndef upgrade():\n{upgrade}\n\n\ndef downgrade():\n{downgrade}\n"
    )
    return path


@pytest.fixture
def run(capsys):
    def _call(*arguments):
        code = gate.main([str(argument) for argument in arguments])
        return code, capsys.readouterr().out

    return _call


# ----------------------------------------------------------------- the clean case


def test_an_additive_revision_passes(tmp_path, run):
    revision = _revision(
        tmp_path,
        """    op.create_table(
        "widgets",
        sa.Column("id", sa.UUID(), nullable=False),
    )
    op.add_column("gadgets", sa.Column("note", sa.String(), nullable=True))""",
    )

    code, output = run(revision)

    assert code == 0
    assert "no destructive operation" in output


def test_a_revision_that_only_drops_in_its_downgrade_passes(tmp_path, run):
    """Almost every additive revision drops in `downgrade()` what it created.

    The pre-upgrade hook never runs `downgrade()`. Scanning it would flag the whole
    tree and the gate would be ignored.
    """
    revision = _revision(
        tmp_path,
        '    op.create_table("widgets", sa.Column("id", sa.UUID(), nullable=False))',
        downgrade='    op.drop_table("widgets")\n    op.drop_column("gadgets", "note")',
    )

    code, output = run(revision)

    assert code == 0
    assert "CRITICAL" not in output


# ------------------------------------------------------------------ the hard stops


def test_drop_column_fails(tmp_path, run):
    revision = _revision(tmp_path, '    op.drop_column("gadgets", "note")')

    code, output = run(revision)

    assert code == 1
    assert "CRITICAL  drop_column" in output
    assert gate.APPROVAL_LABEL in output


def test_drop_table_and_rename_table_fail(tmp_path, run):
    revision = _revision(
        tmp_path,
        '    op.drop_table("gadgets")\n    op.rename_table("widgets", "doodads")',
    )

    code, output = run(revision)

    assert code == 1
    assert "drop_table" in output
    assert "rename_table" in output


def test_not_null_without_a_default_fails(tmp_path, run):
    revision = _revision(
        tmp_path,
        """    op.alter_column(
        "gadgets",
        "note",
        existing_type=sa.String(),
        nullable=False,
    )""",
    )

    code, output = run(revision)

    assert code == 1
    assert "CRITICAL  alter_column" in output
    assert "NOT NULL" in output


def test_not_null_with_a_default_is_only_a_warning(tmp_path, run):
    """A server_default backfills the existing rows, so the running code still writes."""
    revision = _revision(
        tmp_path,
        """    op.alter_column(
        "gadgets",
        "note",
        existing_type=sa.String(),
        nullable=False,
        server_default="",
    )""",
    )

    code, output = run(revision)

    assert code == 0
    assert "CRITICAL" not in output


def test_a_column_rename_fails(tmp_path, run):
    revision = _revision(
        tmp_path,
        '    op.alter_column("gadgets", "note", new_column_name="comment")',
    )

    code, output = run(revision)

    assert code == 1
    assert "renames a column" in output


def test_a_type_change_fails(tmp_path, run):
    revision = _revision(
        tmp_path,
        """    op.alter_column(
        "gadgets",
        "note",
        existing_type=sa.String(),
        type_=sa.Text(),
    )""",
    )

    code, output = run(revision)

    assert code == 1
    assert "changes a column type" in output


def test_a_not_null_add_column_without_a_default_fails(tmp_path, run):
    """PostgreSQL rejects it on a non-empty table, and the old code never sends it."""
    revision = _revision(
        tmp_path,
        '    op.add_column("gadgets", sa.Column("owner_id", sa.UUID(), nullable=False))',
    )

    code, output = run(revision)

    assert code == 1
    assert "CRITICAL  add_column" in output


# --------------------------------------------------------------------- the raw SQL


def test_destructive_sql_in_op_execute_is_caught(tmp_path, run):
    revision = _revision(
        tmp_path,
        '    op.execute("ALTER TABLE gadgets DROP COLUMN note")',
    )

    code, output = run(revision)

    assert code == 1
    assert "execute(ALTER TABLE DROP COLUMN)" in output


def test_destructive_sql_in_an_f_string_helper_is_caught(tmp_path, run):
    """The real tree hides its worst SQL in an f-string inside a module helper.

    See `863f8ebc200f_extend_app_type_again.py`, where `upgrade()` calls
    `_retype_column()` and the `ALTER TABLE ... TYPE` sits in an f-string there.
    """
    path = tmp_path / "abc123_a_revision.py"
    path.write_text(
        HEADER
        + '''
TABLE = "gadgets"


def _retype(to_type: str) -> None:
    op.execute(
        f"""
        ALTER TABLE {TABLE}
        ALTER COLUMN note
        TYPE {to_type}
        """
    )


def upgrade():
    _retype("text")


def downgrade():
    _retype("varchar")
'''
    )

    code, output = run(path)

    assert code == 1
    assert "execute(ALTER TABLE ALTER TYPE)" in output


def test_a_helper_reached_only_from_downgrade_is_not_scanned(tmp_path):
    path = tmp_path / "abc123_a_revision.py"
    path.write_text(
        HEADER
        + """
def _wreck() -> None:
    op.execute("DROP TABLE gadgets")


def upgrade():
    op.add_column("gadgets", sa.Column("note", sa.String(), nullable=True))


def downgrade():
    _wreck()
"""
    )

    assert gate.scan_source(path.read_text(), str(path)) == []


def test_sql_in_a_connection_execute_is_caught(tmp_path, run):
    """`conn.execute(...)` and `session.execute(...)` both appear in this tree."""
    revision = _revision(
        tmp_path,
        """    conn = op.get_bind()
    conn.execute(sa.text("TRUNCATE gadgets"))""",
    )

    code, output = run(revision)

    assert code == 1
    assert "execute(TRUNCATE)" in output


# ----------------------------------------------------------- the warning-only rules


def test_a_non_concurrent_index_warns_but_passes(tmp_path, run):
    revision = _revision(
        tmp_path,
        '    op.create_index("ix_gadgets_note", "gadgets", ["note"])',
    )

    code, output = run(revision)

    assert code == 0
    assert "WARNING  create_index" in output


def test_an_index_on_a_table_this_revision_creates_is_not_flagged(tmp_path, run):
    """A new table is empty, and PostgreSQL refuses CONCURRENTLY in a transaction."""
    revision = _revision(
        tmp_path,
        """    op.create_table("widgets", sa.Column("note", sa.String(), nullable=True))
    op.create_index("ix_widgets_note", "widgets", ["note"])""",
    )

    code, output = run(revision)

    assert code == 0
    assert "create_index" not in output


def test_a_constraint_dropped_and_created_again_is_not_flagged(tmp_path, run):
    """Changing an `ondelete` rule is a redefinition, not a removal."""
    revision = _revision(
        tmp_path,
        """    op.drop_constraint("gadgets_owner_fkey", "gadgets", type_="foreignkey")
    op.create_foreign_key(
        "gadgets_owner_fkey", "gadgets", "owners", ["owner_id"], ["id"]
    )""",
    )

    code, output = run(revision)

    assert code == 0
    assert "drop_constraint" not in output


# --------------------------------------------------------------- batch_alter_table


def test_a_batch_drop_column_fails(tmp_path, run):
    """Nothing in this tree uses `batch_alter_table` yet. The gate covers it anyway."""
    revision = _revision(
        tmp_path,
        """    with op.batch_alter_table("gadgets") as batch_op:
        batch_op.drop_column("note")""",
    )

    code, output = run(revision)

    assert code == 1
    assert "CRITICAL  drop_column" in output


def test_a_batch_operation_is_scoped_to_the_context_manager_table(tmp_path, run):
    """A batch operation takes the column first, so the table must come from the block.

    Reading the first argument as the table would wrongly suppress this finding,
    because a table called `note` is created in the same revision.
    """
    revision = _revision(
        tmp_path,
        """    op.create_table("note", sa.Column("id", sa.UUID(), nullable=False))
    with op.batch_alter_table("gadgets") as batch_op:
        batch_op.drop_column("note")""",
    )

    code, output = run(revision)

    assert code == 1, "the drop was suppressed by an unrelated table of the same name"


def test_a_batch_drop_on_a_table_this_revision_creates_is_not_flagged(tmp_path, run):
    revision = _revision(
        tmp_path,
        """    op.create_table("widgets", sa.Column("note", sa.String(), nullable=True))
    with op.batch_alter_table("widgets") as batch_op:
        batch_op.drop_column("note")""",
    )

    code, output = run(revision)

    assert code == 0
    assert "CRITICAL" not in output


# -------------------------------------------------------------------- the approval


def test_the_label_turns_a_critical_finding_into_a_pass(tmp_path, run):
    revision = _revision(tmp_path, '    op.drop_column("gadgets", "note")')

    code, output = run(revision, "--approved")

    assert code == 0
    assert "CRITICAL  drop_column" in output, "an approved finding is still printed"
    assert "approved by the" in output


# ------------------------------------------------------------------- output shapes


def test_the_github_format_annotates_the_file_and_line(tmp_path, run):
    revision = _revision(tmp_path, '    op.drop_column("gadgets", "note")')

    code, output = run(revision, "--format", "github")

    assert code == 1
    assert "::error file=" in output
    assert f"line={gate.scan_source(revision.read_text(), 'x')[0].line}" in output


def test_the_json_format_carries_the_counts_and_the_verdict(tmp_path, run):
    revision = _revision(tmp_path, '    op.drop_column("gadgets", "note")')

    code, output = run(revision, "--format", "json")
    summary = json.loads(output)

    assert code == 1
    assert summary["critical"] == 1
    assert summary["passed"] is False
    assert summary["approval_label"] == gate.APPROVAL_LABEL
    assert summary["findings"][0]["operation"] == "drop_column"


def test_a_revision_that_does_not_parse_fails_closed(tmp_path, run):
    path = tmp_path / "abc123_broken.py"
    path.write_text("def upgrade(:\n    pass\n")

    code, output = run(path)

    assert code == 1
    assert "unparseable" in output


def test_no_revision_files_passes(run):
    code, output = run()

    assert code == 0
    assert "no revision files" in output


def test_a_missing_path_is_a_usage_error(tmp_path, run):
    code, _ = run(tmp_path / "nope.py")

    assert code == 2


# ----------------------------------------------------------------- the wiring, live


def test_the_gate_finds_every_revision_in_this_repository():
    """`--all` must keep matching the real tree, or the audit silently covers nothing."""
    discovered = gate.discover_revisions(_REPO)
    expected = sorted(_REPO.glob(_VERSIONS_GLOB))

    assert discovered == expected
    assert len(discovered) > 200, f"only {len(discovered)} revisions discovered"


def test_the_workflow_runs_the_script_and_reads_the_label():
    workflow = (
        _REPO / ".github" / "workflows" / "21-check-migration-gate.yml"
    ).read_text()

    assert "api/scripts/migration_gate.py" in workflow
    assert gate.APPROVAL_LABEL in workflow
    for event in ("labeled", "unlabeled", "opened", "synchronize", "reopened"):
        assert event in workflow, f"the gate does not re-run on {event}"


def test_the_approval_label_exists_in_the_repository():
    labels = (_REPO / ".github" / ".labels.yml").read_text()

    assert f"- name: {gate.APPROVAL_LABEL}" in labels
