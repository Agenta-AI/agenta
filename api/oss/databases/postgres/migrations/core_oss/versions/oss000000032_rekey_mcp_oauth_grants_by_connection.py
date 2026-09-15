"""Move stored MCP OAuth grants onto the connection-derived key.

A grant used to be stored in the vault under a slug derived from the MCP server URL, so
every connection in a project that named the same server computed the same slug and
converged on one row. The code now derives that slug from the connection instead. This
revision moves the rows that already exist.

Two cases, and only two.

A grant that exactly one live connection references is that connection's, whoever wrote
it, so it is renamed to the new key and the connection keeps working with no reconnect.

A grant that several connections reference holds the tokens of whichever consent ran
last, and nothing recorded which one that was. There is no honest way to hand it to one
of them. Those connections have their handle cleared and the row is deleted, so each
reads as needing authorization and one Connect makes it correct again. This is the only
step here that destroys anything, and it destroys credentials that were already wrong
for every connection but one.

Data only. No table, column, index or constraint changes.

Revision ID: oss000000032
Revises: oss000000031
Create Date: 2026-09-15 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "oss000000032"
down_revision: Union[str, None] = "oss000000031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The connections that hold a stored grant. `sharers` counts how many of them name the
# same vault row, which is the whole question this revision turns on. Soft-deleted rows
# are excluded: a deleted connection must not keep a live one's grant ambiguous.
_REFERENCING = """
    SELECT
        endpoint.id AS endpoint_id,
        endpoint.project_id AS project_id,
        endpoint.secret_id AS secret_id,
        count(*) OVER (PARTITION BY endpoint.secret_id) AS sharers
    FROM mcps_endpoints AS endpoint
    WHERE endpoint.auth_mode = 'OAUTH'
      AND endpoint.secret_id IS NOT NULL
      AND endpoint.deleted_at IS NULL
"""

# `get_slug_from_name_and_id("oauth-grant", endpoint_id)`, in SQL. That helper slugifies
# the name and appends the last twelve hex characters of the id; "oauth-grant" survives
# slugification unchanged, and a UUID's hex is already lowercase.
_NEW_SLUG = "'oauth-grant-' || right(replace(sole.endpoint_id::text, '-', ''), 12)"


def upgrade() -> None:
    connection = op.get_bind()

    # Bounded waits. Every statement below touches `secrets` or `mcps_endpoints`, which a
    # running deployment writes to, and an unbounded `lock_timeout` lets this revision
    # queue behind a long transaction and hold the migration slot indefinitely. Failing
    # and being re-run is the better outcome: this revision is idempotent.
    connection.execute(sa.text("SET LOCAL lock_timeout = '5s'"))
    connection.execute(sa.text("SET LOCAL statement_timeout = '5min'"))

    # A destination slug the new writer already created, before this ran (D4).
    #
    # The connection consented under the new code, which stored its grant at
    # `oauth-grant-<its own id>`, and then something failed before the endpoint was
    # repointed at it — an interrupted callback is the way to get here. So the endpoint
    # still names the legacy row while the row at its new key already exists, and
    # renaming the legacy row onto that key would hit `uq_secrets_project_id_slug` and
    # fail the whole migration.
    #
    # The occupant is this connection's own grant, by construction: nothing else computes
    # that slug. So the endpoint is repointed at it, which is what the interrupted
    # callback was about to do. The legacy row is left as an orphan rather than deleted,
    # matching what this revision does with every other orphan, and the endpoint ends up
    # naming the newer of the two credentials.
    adopted = connection.execute(
        sa.text(
            f"""
            WITH referencing AS ({_REFERENCING}),
                 sole AS (SELECT * FROM referencing WHERE sharers = 1)
            UPDATE mcps_endpoints AS endpoint
               SET secret_id = occupant.id,
                   updated_at = now()
              FROM sole
              JOIN secrets AS occupant
                ON occupant.project_id = sole.project_id
               AND occupant.kind = 'OAUTH_GRANT'
               AND occupant.slug = {_NEW_SLUG}
             WHERE endpoint.id = sole.endpoint_id
               AND endpoint.project_id = sole.project_id
               AND occupant.id <> sole.secret_id
            """
        )
    ).rowcount

    # Read the ambiguous set first and delete by id later. The membership test is "more
    # than one live connection names this row", and clearing the handles is what stops
    # that being true, so a second query asking the same question would find nothing.
    # It cannot be inferred from the slug either: the old key and the new one have the
    # same `oauth-grant-<twelve hex>` shape, differing only in which id they hash.
    shared_grant_ids = (
        connection.execute(
            sa.text(
                f"""
                WITH referencing AS ({_REFERENCING})
                SELECT DISTINCT secret_id FROM referencing WHERE sharers > 1
                """
            )
        )
        .scalars()
        .all()
    )

    # After the adoption above, an endpoint whose destination was occupied now names the
    # occupant, whose slug already IS the destination, so the rename is a no-op for it
    # rather than a conflict. The `NOT EXISTS` is the belt to that braces: any other row
    # still holding the destination — a different kind, say, since the unique index does
    # not look at kind — makes this revision skip that one rename instead of aborting.
    # Skipped rows are reported below rather than passed over in silence.
    renamed = connection.execute(
        sa.text(
            f"""
            WITH referencing AS ({_REFERENCING}),
                 sole AS (SELECT * FROM referencing WHERE sharers = 1)
            UPDATE secrets AS secret
               SET slug = {_NEW_SLUG}
              FROM sole
             WHERE secret.id = sole.secret_id
               AND secret.project_id = sole.project_id
               AND secret.kind = 'OAUTH_GRANT'
               AND NOT EXISTS (
                   SELECT 1
                     FROM secrets AS occupant
                    WHERE occupant.project_id = sole.project_id
                      AND occupant.slug = {_NEW_SLUG}
                      AND occupant.id <> sole.secret_id
               )
            """
        )
    ).rowcount

    disconnected = 0
    deleted = 0
    if shared_grant_ids:
        # Clear the handles before dropping the rows. The foreign key is ON DELETE SET
        # NULL and would do it anyway; doing it here is what makes the intent readable
        # in the revision rather than inferable from the schema.
        disconnected = connection.execute(
            sa.text(
                """
                UPDATE mcps_endpoints
                   SET secret_id = NULL,
                       updated_at = now()
                 WHERE secret_id = ANY(:shared_grant_ids)
                """
            ),
            {"shared_grant_ids": list(shared_grant_ids)},
        ).rowcount

        # By id, so a grant that was already orphaned before this revision ran is left
        # exactly where it was. Cleaning those up is not this revision's business.
        deleted = connection.execute(
            sa.text(
                """
                DELETE FROM secrets
                 WHERE id = ANY(:shared_grant_ids)
                   AND kind = 'OAUTH_GRANT'
                """
            ),
            {"shared_grant_ids": list(shared_grant_ids)},
        ).rowcount

    summary = (
        f"[oss000000032] rekeyed {renamed} MCP OAuth grant(s) onto their connection; "
        f"cleared {disconnected} handle(s) that shared {deleted} ambiguous grant(s), "
        f"which now need a reconnect."
    )
    if adopted:
        summary += (
            f" {adopted} connection(s) already had a grant at their new key and were "
            f"repointed at it; the row each previously named is left as an orphan."
        )
    print(summary)


def downgrade() -> None:
    """Deliberately does nothing, and this is safe for the renamed rows but not the
    deleted ones.

    The renames need no undo. The previous revision's code never addressed a grant by
    its slug on the read path: it listed the project's secrets and matched the payload's
    `server` field, and its write reused whatever that scan returned. So it finds and
    updates these rows under their new slugs exactly as it did under the old ones, and
    renaming them back would change nothing it can observe.

    The deleted rows cannot come back. They held one account's tokens while several
    connections claimed them, so there was nothing to preserve for the others; after a
    downgrade those connections are simply unconnected and must consent again. Restoring
    them is not possible and pretending otherwise would be worse than saying so.
    """
