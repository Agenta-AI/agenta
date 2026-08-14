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

Idempotent: `ON CONFLICT (organization_id) WHERE wallet_credit_id IS NULL DO NOTHING`
against the same partial unique index `uq_wallet_balances_org_general` that
`WalletsDAO.provision_general_balance` relies on — re-running this migration inserts
nothing on organizations already provisioned (by this migration, or by the
organization-creation flow having already run since). Safe on an empty database (the
`SELECT` returns no rows) and safe interleaved with live traffic (a concurrent
`provision_general_balance` call racing this migration for the same organization is
resolved by the same conflict target either way — whichever writes first wins, the other
does nothing).

Downgrade is a deliberate no-op: by the time of a downgrade, a backfilled row's
`balance_musd` may already reflect real settled debits, and a general row may exist for
reasons other than this migration (organization creation running concurrently, or a
credit/debit having already posted against it). Deleting rows here cannot distinguish
"created only by this migration, still untouched" from "created here but already carries
real financial state" — so this downgrade does NOT remove any `wallet_balances` row; it
only reverses the schema-only migration below it (`ee0000000005`) when downgraded further.

Revision ID: ee0000000006
Revises: ee0000000005
Create Date: 2026-08-14 00:20:00.000000
"""

from typing import Sequence, Union

from alembic import op

revision: str = "ee0000000006"
down_revision: Union[str, None] = "ee0000000005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO wallet_balances
            (id, organization_id, wallet_credit_id, balance_musd, floor_musd)
        SELECT
            gen_random_uuid(),
            o.id,
            NULL,
            0,
            0  -- floor_musd: mirrors ee.src.core.wallets.plans.floor_musd_for_plan,
               -- currently a constant 0 for every plan (s.plan is read only to make
               -- that dependency explicit for when the mapping stops being constant).
        FROM organizations o
        LEFT JOIN subscriptions s ON s.organization_id = o.id
        WHERE NOT EXISTS (
            SELECT 1 FROM wallet_balances wb
            WHERE wb.organization_id = o.id AND wb.wallet_credit_id IS NULL
        )
        ON CONFLICT (organization_id) WHERE wallet_credit_id IS NULL DO NOTHING
        """
    )


def downgrade() -> None:
    # Deliberate no-op — see the module docstring: a backfilled general balance row may
    # already carry real settled financial state by the time of a downgrade, and this
    # migration cannot distinguish that from an untouched row. Nothing safe to remove.
    pass
