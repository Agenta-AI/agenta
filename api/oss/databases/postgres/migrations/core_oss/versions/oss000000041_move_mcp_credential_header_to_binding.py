"""move the MCP credential header onto a credential binding

An MCP endpoint used to name its API-key header in `data.route.credential_header`, and
the relay sent the vault value verbatim under that name. The route now carries
`data.route.credential_binding`, which says where the value goes (a header or a query
parameter), under which name, and with which prefix. This revision rewrites the rows
that carry the old field.

A named header becomes a header binding with that name and no prefix, which is exactly
what the relay sent before. A blank or null name was sent as `Authorization: Bearer <key>`,
which is what a route with no binding sends now, so that field is dropped and nothing
replaces it.

Data only. `data` is a `json` column, so each row is read as `jsonb` to edit and written
back as `json`.

Downgrade writes a header binding with no prefix back as `credential_header`. A binding
the old field cannot express (a query parameter, a prefix, or a key in the URL) is
dropped, so that row falls back to `Authorization: Bearer <key>`.

A row whose `base_url` holds `{secret}` loses its `url` binding on downgrade but keeps the
placeholder, and the API refuses to read a placeholder with no `url` binding. Without a
repair, one such row after a rollback and a new upgrade hides every MCP endpoint of its
project from the list. So upgrade also gives such a row its `url` binding back.

Revision ID: oss000000041
Revises: oss000000040
Create Date: 2026-10-14 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op

revision: str = "oss000000041"
down_revision: Union[str, None] = "oss000000040"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE mcps_endpoints
        SET data = (
            CASE
                WHEN coalesce(btrim(data::jsonb #>> '{route,credential_header}'), '') = ''
                THEN data::jsonb #- '{route,credential_header}'
                ELSE jsonb_set(
                    data::jsonb #- '{route,credential_header}',
                    '{route,credential_binding}',
                    jsonb_build_object(
                        'kind', 'header',
                        'name', btrim(data::jsonb #>> '{route,credential_header}')
                    )
                )
            END
        )::json
        WHERE data::jsonb #> '{route,credential_header}' IS NOT NULL
        """
    )
    op.execute(
        """
        UPDATE mcps_endpoints
        SET data = jsonb_set(
            data::jsonb,
            '{route,credential_binding}',
            jsonb_build_object('kind', 'url')
        )::json
        WHERE strpos(data::jsonb #>> '{route,base_url}', '{secret}') > 0
            AND data::jsonb #> '{route,credential_binding}' IS NULL
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE mcps_endpoints
        SET data = (
            CASE
                WHEN data::jsonb #>> '{route,credential_binding,kind}' = 'header'
                    AND data::jsonb #>> '{route,credential_binding,prefix}' IS NULL
                THEN jsonb_set(
                    data::jsonb #- '{route,credential_binding}',
                    '{route,credential_header}',
                    data::jsonb #> '{route,credential_binding,name}'
                )
                ELSE data::jsonb #- '{route,credential_binding}'
            END
        )::json
        WHERE data::jsonb #> '{route,credential_binding}' IS NOT NULL
        """
    )
