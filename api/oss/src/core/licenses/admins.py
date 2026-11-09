"""The instance admin: the person who manages the license of a self-hosted instance.

An email in `AGENTA_ACCESS_ALLOWED_OWNER_EMAILS`, or, when that list is unset, the
owner of the oldest organization.
"""

from uuid import UUID

from sqlalchemy import func, select

from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.models.db_models import OrganizationDB, UserDB
from oss.src.utils.env import env


async def is_instance_admin(user_id: UUID) -> bool:
    allowed_emails = env.agenta.access.allowed_owner_emails

    async with get_transactions_engine().session() as session:
        if allowed_emails is not None:
            email = (
                await session.execute(select(UserDB.email).where(UserDB.id == user_id))
            ).scalar_one_or_none()
            return bool(email) and email.strip().lower() in allowed_emails

        owner_id = (
            await session.execute(
                select(OrganizationDB.owner_id)
                .where(OrganizationDB.deleted_at.is_(None))
                .order_by(
                    OrganizationDB.created_at.asc().nulls_last(),
                    OrganizationDB.id.asc(),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        return owner_id == user_id


async def count_users() -> int:
    """Seats in use on the instance."""
    async with get_transactions_engine().session() as session:
        return (
            await session.execute(
                select(func.count(UserDB.id)).where(UserDB.deleted_at.is_(None))
            )
        ).scalar_one()
