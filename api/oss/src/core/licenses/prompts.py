"""The registration prompt an instance admin sees once after an upgrade.

Skipping it is stored per instance, in the `meta` of the oldest organization (the one
whose owner is the instance admin), so it stays skipped in every browser. There is no
per-user preference store to hold it.
"""

from datetime import datetime, timezone

from sqlalchemy import select

from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.models.db_models import OrganizationDB

DISMISSED_AT = "registration_prompt_dismissed_at"


def _oldest_organization():
    return (
        select(OrganizationDB)
        .where(OrganizationDB.deleted_at.is_(None))
        .order_by(
            OrganizationDB.created_at.asc().nulls_last(),
            OrganizationDB.id.asc(),
        )
        .limit(1)
    )


async def is_registration_prompt_dismissed() -> bool:
    async with get_transactions_engine().session() as session:
        organization = (
            await session.execute(_oldest_organization())
        ).scalar_one_or_none()
        return bool(organization and (organization.meta or {}).get(DISMISSED_AT))


async def dismiss_registration_prompt() -> None:
    async with get_transactions_engine().session() as session:
        organization = (
            await session.execute(_oldest_organization().with_for_update())
        ).scalar_one_or_none()
        if organization is None:
            return
        meta = dict(organization.meta or {})
        if meta.get(DISMISSED_AT):
            return
        meta[DISMISSED_AT] = datetime.now(timezone.utc).isoformat()
        # A new dict, so SQLAlchemy sees the JSONB change.
        organization.meta = meta
