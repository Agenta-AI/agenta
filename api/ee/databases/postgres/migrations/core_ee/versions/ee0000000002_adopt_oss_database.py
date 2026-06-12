"""create EE-only schema if missing and backfill billing (OSS adoption)

Conditional by construction, so the same revision serves every flow:

- database coming from EE: every object already exists (built by the legacy
  EE chain), every backfill target is populated -- complete no-op.
- database coming from OSS (edition switch): creates the EE-only enum and
  tables in their canonical post-cleanup shapes, then backfills one
  subscription per organization on the default plan (anchor = day of
  adoption) and the USERS gauge recomputed from organization_members.
  Domains and providers start empty.

References only EE tables and forever-stable shared PKs (organizations.id,
secrets.id), per the chain rules.

Revision ID: ee0000000002
Revises: ee0000000001
Create Date: 2026-06-12 00:00:11.000000

"""

from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op

from ee.src.core.subscriptions.types import get_default_plan

# revision identifiers, used by Alembic.
revision: str = "ee0000000002"
down_revision: Union[str, None] = "ee0000000001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


LIFECYCLE = """
        created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz,
        deleted_at timestamptz,
        created_by_id uuid,
        updated_by_id uuid,
        deleted_by_id uuid
"""


def upgrade() -> None:
    # -- ENUM (no CREATE TYPE IF NOT EXISTS in postgres; guard explicitly) -------
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE meters_type AS ENUM (
                'USERS', 'EVALUATIONS_RUN', 'TRACES_INGESTED',
                'TRACES_RETRIEVED', 'CREDITS_CONSUMED', 'EVENTS_INGESTED'
            );
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
        """
    )

    # -- TABLES (canonical post-cleanup shapes) -----------------------------------
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS subscriptions (
            organization_id uuid PRIMARY KEY
                REFERENCES organizations(id) ON DELETE CASCADE,
            plan varchar NOT NULL,
            active boolean NOT NULL,
            anchor smallint,
            customer_id varchar,
            subscription_id varchar,
            {LIFECYCLE}
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_subscriptions_plan ON subscriptions (plan)"
    )

    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS meters (
            meter_id uuid PRIMARY KEY,
            key meters_type NOT NULL,
            value bigint NOT NULL,
            synced bigint NOT NULL,
            organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
            workspace_id uuid,
            project_id uuid,
            user_id uuid,
            year smallint,
            month smallint,
            day smallint,
            {LIFECYCLE}
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_synced_value ON meters (synced, value)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_meters_org_key_period"
        " ON meters (organization_id, key, year, month, day)"
    )

    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS organization_domains (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL
                REFERENCES organizations(id) ON DELETE CASCADE,
            slug varchar NOT NULL,
            name varchar,
            description varchar,
            token varchar,
            flags jsonb,
            tags jsonb,
            meta json,
            {LIFECYCLE}
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_organization_domains_org"
        " ON organization_domains (organization_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_organization_domains_flags"
        " ON organization_domains USING gin (flags)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_domains_slug_verified"
        " ON organization_domains (slug)"
        " WHERE ((flags ->> 'is_verified') = 'true')"
    )

    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS organization_providers (
            id uuid PRIMARY KEY,
            organization_id uuid NOT NULL
                REFERENCES organizations(id) ON DELETE CASCADE,
            slug varchar NOT NULL,
            name varchar,
            description varchar,
            secret_id uuid NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
            flags jsonb,
            tags jsonb,
            meta json,
            {LIFECYCLE},
            CONSTRAINT uq_organization_providers_org_slug
                UNIQUE (organization_id, slug)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_organization_providers_org"
        " ON organization_providers (organization_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_organization_providers_flags"
        " ON organization_providers USING gin (flags)"
    )

    # -- BACKFILL (only rows that do not exist; no-op on EE-origin databases) ----
    plan = get_default_plan()
    plan = getattr(plan, "value", plan)
    anchor = datetime.now(timezone.utc).day

    op.execute(
        f"""
        INSERT INTO subscriptions (organization_id, plan, active, anchor)
        SELECT o.id, '{plan}', true, {anchor}
        FROM organizations o
        WHERE NOT EXISTS (
            SELECT 1 FROM subscriptions s WHERE s.organization_id = o.id
        )
        """
    )

    op.execute(
        """
        INSERT INTO meters (meter_id, key, value, synced, organization_id, year, month)
        SELECT
            gen_random_uuid(),
            CAST('USERS' AS meters_type),
            (SELECT count(*) FROM organization_members m
             WHERE m.organization_id = o.id),
            0,
            o.id,
            0,
            0
        FROM organizations o
        WHERE NOT EXISTS (
            SELECT 1 FROM meters mm
            WHERE mm.organization_id = o.id
              AND mm.key = CAST('USERS' AS meters_type)
        )
        """
    )


def downgrade() -> None:
    # Adoption is additive and idempotent; nothing safe to remove.
    pass
