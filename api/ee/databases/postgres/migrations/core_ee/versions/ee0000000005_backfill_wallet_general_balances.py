"""backfill wallet_balances general row for every existing organization

Closes the provisioning gap for organizations that existed before
`ee.src.core.organizations.service.provision_signup_subscription` /
`provision_user_subscription` started provisioning the general wallet balance row on
creation (see `ee0000000004_add_wallet_tables.py` for the table itself). Without this
backfill, a debit for one of those organizations raises
`WalletGeneralBalanceNotFoundError`, which `DebitWorker` treats as retryable — a poison
message that redelivers forever.

`organizations` is reachable from this chain: `ee0000000002_adopt_oss_database.py`
already references it directly (`REFERENCES organizations(id)`) because `core_ee` and OSS
`core` are the SAME physical database (see that migration's docstring). This migration
only SELECTs organization ids and `subscriptions.plan` (read-only, existing OSS/adopted
tables) and INSERTs into `wallet_balances` (EE-owned table) — no OSS table is altered,
widened, or written.

Written in raw SQL against the tables, not through `ee.src.core.wallets.service`: a
migration must not depend on application code that may change shape after this revision
ships. `floor_musd` mirrors `ee.src.core.wallets.plans.floor_musd_for_plan`, which returns
a constant 0 for every plan today (no plan carries a floor value yet — see that module's
docstring); `subscriptions.plan` is still read and left in the query so the mirrored
mapping is explicit at the callsite, not silently dropped, for whenever that mapping stops
being a constant.

Row ids are minted in Python with `uuid_utils.compat.uuid7`, matching this repository's
id-minting convention (see `oss.src.dbs.postgres.shared.dbas.IdentifierDBA`,
`oss.src.dbs.postgres.sessions.streams.dao`), not `gen_random_uuid()` (uuid4) — a
migration has no equivalent of `Column(default=uuid.uuid7)` to fall back on, and there is
no built-in pure-SQL uuidv7 generator available on the Postgres version this repository
targets, so the ids are minted here in Python and passed down as literal values, one
`INSERT` per organization rather than a single `INSERT ... SELECT`.

Processed in keyset-paginated chunks of `BATCH_SIZE` organizations, ordered by
`organizations.id` so the primary-key index drives each page, following the precedent in
`ee/databases/postgres/migrations/core/versions/a2b3c4d5e6f8_backfill_default_evaluation_queues.py`.
An installation with a large `organizations` table therefore never has every organization
id in Python memory at once, and never issues one statement batch proportional to the
whole table. The chunk cursor is the id, not an offset, so rows this migration has just
inserted (which drop out of the `NOT EXISTS` filter as it goes) can neither be revisited
nor cause a page to be skipped. Alembic still owns the single surrounding transaction, as
it does for every migration in this chain; what is bounded here is the memory held and
the work per statement, not the transaction boundary.

Idempotent: `ON CONFLICT (organization_id) WHERE wallet_credit_id IS NULL DO NOTHING`
against the same partial unique index `uq_wallet_balances_org_general` that
`WalletsDAO.provision_general_balance` relies on — re-running this migration inserts
nothing on organizations already provisioned (by this migration, or by the
organization-creation flow having already run since). Safe on an empty database (the
`SELECT` returns no rows) and safe interleaved with live traffic (a concurrent
`provision_general_balance` call racing this migration for the same organization is
resolved by the same conflict target either way — whichever writes first wins, the other
does nothing).

Runs regardless of `AGENTA_WALLETS_ENABLED`, deliberately: a revision's meaning must not
depend on the runtime environment of whoever applies it, or the same revision number means
different database states on two installations and the next revision cannot rely on
either. The rows it writes are inert while the feature flag is off (a zero balance with a
zero floor on an EE-owned table nothing reads), and provisioning them ahead of the flag is
exactly the point: the flag can then be flipped without a migration window.

Downgrade is a deliberate no-op: by the time of a downgrade, a backfilled row's
`balance_musd` may already reflect real settled debits, and a general row may exist for
reasons other than this migration (organization creation running concurrently, or a
credit/debit having already posted against it). Deleting rows here cannot distinguish
"created only by this migration, still untouched" from "created here but already carries
real financial state" — so this downgrade does NOT remove any `wallet_balances` row; it
only reverses the schema-only migration below it (`ee0000000004`, the wallet tables
themselves) when downgraded further.

Revision ID: ee0000000005
Revises: ee0000000004
Create Date: 2026-08-14 00:20:00.000000
"""

from typing import Sequence, Union

import uuid_utils.compat as uuid_utils
from alembic import op
from sqlalchemy import text

revision: str = "ee0000000005"
down_revision: Union[str, None] = "ee0000000004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Organizations per keyset page. A few thousand keeps both the Python-side row list and
# the parameter batch of one INSERT bounded on an installation of any size, while staying
# large enough that the page count stays trivial for the installations we actually run.
BATCH_SIZE = 2_000

# Keyset cursor seed. `organizations.id` is a native uuid, so the comparison is against a
# uuid (a text cast would not be sargable and would order differently).
_ZERO_UUID = "00000000-0000-0000-0000-000000000000"

# One page of organizations still missing their general balance row.
# `subscriptions.plan` is joined (and left unused below) only to keep the dependency on
# the plan->floor mapping explicit at the callsite — see the module docstring. The join is
# LEFT and fans out if an organization ever carries more than one subscription row, which
# would make a page of BATCH_SIZE rows cover fewer than BATCH_SIZE organizations; DISTINCT
# removes that, and costs nothing extra because the keyset already orders by o.id.
_NEXT_ORGANIZATION_IDS = text(
    """
    SELECT DISTINCT o.id
    FROM organizations o
    LEFT JOIN subscriptions s ON s.organization_id = o.id
    WHERE o.id > CAST(:cursor AS uuid)
      AND NOT EXISTS (
        SELECT 1 FROM wallet_balances wb
        WHERE wb.organization_id = o.id AND wb.wallet_credit_id IS NULL
      )
    ORDER BY o.id
    LIMIT :batch
    """
)

_INSERT_GENERAL_BALANCE = text(
    """
    INSERT INTO wallet_balances
        (id, organization_id, wallet_credit_id, balance_musd, floor_musd)
    VALUES (:id, :organization_id, NULL, 0, 0)
    ON CONFLICT (organization_id) WHERE wallet_credit_id IS NULL DO NOTHING
    """
)


def upgrade() -> None:
    bind = op.get_bind()

    cursor = _ZERO_UUID

    while True:
        rows = bind.execute(
            _NEXT_ORGANIZATION_IDS,
            {"cursor": cursor, "batch": BATCH_SIZE},
        ).fetchall()

        if not rows:
            return

        bind.execute(
            _INSERT_GENERAL_BALANCE,
            [{"id": uuid_utils.uuid7(), "organization_id": row.id} for row in rows],
        )

        # Advance past the last id of this page. The rows just written drop out of the
        # NOT EXISTS filter, so the cursor is what guarantees forward progress rather
        # than the filter — and an organization that somehow still matches (a concurrent
        # delete of its balance row, say) cannot re-serve the same page forever.
        cursor = str(rows[-1].id)

        if len(rows) < BATCH_SIZE:
            return


def downgrade() -> None:
    # Deliberate no-op — see the module docstring: a backfilled general balance row may
    # already carry real settled financial state by the time of a downgrade, and this
    # migration cannot distinguish that from an untouched row. Nothing safe to remove.
    pass
