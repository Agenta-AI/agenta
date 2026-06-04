"""strip unknown top-level keys from workflow_revisions.data

WorkflowRevisionData enforces extra="forbid" on the allowed top-level keys
(uri, url, headers, runtime, script, schemas, parameters). Legacy rows that
still carry other keys (e.g. 'mappings', 'service', 'configuration') trip
Pydantic validation on read; the query endpoint silently swallows the
exception and returns an empty result. This rewrites such rows to keep
only the allowed keys.

Revision ID: c4d5e6f7a8b9
Revises: b2c3d4e5f7a8
Create Date: 2026-05-26 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import context

from oss.databases.postgres.migrations.core.data_migrations.workflow_revision_data_extras import (
    downgrade_workflow_revision_data_extras,
    upgrade_workflow_revision_data_extras,
)

# revision identifiers, used by Alembic.
revision: str = "c4d5e6f7a8b9"
down_revision: Union[str, None] = "b2c3d4e5f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = context.get_bind()
    upgrade_workflow_revision_data_extras(session=connection)


def downgrade() -> None:
    connection = context.get_bind()
    downgrade_workflow_revision_data_extras(session=connection)
