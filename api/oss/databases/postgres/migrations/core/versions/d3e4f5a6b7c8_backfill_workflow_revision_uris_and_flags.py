"""backfill workflow revision URIs and normalize flags

Backfill missing URIs on workflow_revisions based on legacy flags and URL
presence.  Normalize flags to the canonical role set (is_evaluator,
is_application, is_snippet) and strip legacy JSONB keys (service,
configuration, script-as-object).

Phase 1 — rows with no URI get a URI assigned from flags/URL heuristics.
Phase 2 — rows with an existing URI get flags and legacy fields normalized.

See docs/designs/runnables/migrations.sql for the full row-by-row analysis.

Revision ID: d3e4f5a6b7c8
Revises: b1c2d3e4f5a6
Create Date: 2026-04-01 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import context

from oss.databases.postgres.migrations.core.data_migrations.workflow_revisions import (
    upgrade_workflow_revisions,
    downgrade_workflow_revisions,
)

# revision identifiers, used by Alembic.
revision: str = "d3e4f5a6b7c8"
down_revision: Union[str, None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = context.get_bind()
    upgrade_workflow_revisions(session=connection)


def downgrade() -> None:
    connection = context.get_bind()
    downgrade_workflow_revisions(session=connection)
