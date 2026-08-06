"""migrate data.script from string to object

Revision ID: baa02d66a365
Revises: 863f8ebc200f
Create Date: 2025-11-06 15:49:00
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "baa02d66a365"
down_revision: Union[str, None] = "863f8ebc200f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Convert data.script from a JSON string to:
    # {"content": <old string>, "runtime": "python"}
    op.execute(
        sa.text(
            """
            UPDATE public.workflow_revisions
            SET data = jsonb_set(
                         data::jsonb,
                         '{script}',
                         jsonb_build_object(
                           'content', data->>'script',
                           'runtime', 'python'
                         )
                       )::json
            WHERE data->>'script' IS NOT NULL
              AND json_typeof(data->'script') = 'string';
            """
        )
    )


def downgrade() -> None:
    # Revert only objects shaped like:
    # {"content": <string>, "runtime": "python"}  ->  "<string>"
    op.execute(
        sa.text(
            """
            UPDATE public.workflow_revisions
            SET data = jsonb_set(
                         data::jsonb,
                         '{script}',
                         to_jsonb( (data->'script'->>'content') )
                       )::json
            WHERE json_typeof(data->'script') = 'object'
              AND (data->'script') ? 'content'
              AND json_typeof(data->'script'->'content') = 'string'
              AND (
                    (data->'script' ? 'runtime') IS FALSE
                    OR (data->'script'->>'runtime') = 'python'
                  );
            """
        )
    )
