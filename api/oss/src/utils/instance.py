"""The id of this deployment, read once from the `instances` table.

Analytics uses it to count deployments and to keep two deployments apart: the same
email on two deployments is two people. The row is created by a migration and kept
across upgrades.
"""

from typing import Optional

from sqlalchemy import text

from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.common import is_ee
from oss.src.utils.lazy import _load_posthog
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

INSTANCE_GROUP = "instance"

_instance_id: Optional[str] = None


async def load_instance_id() -> Optional[str]:
    """Read the instance id into memory. Call once at startup."""
    global _instance_id

    try:
        engine = get_transactions_engine()
        async with engine.session() as session:
            result = await session.execute(text("SELECT id FROM instances LIMIT 1"))
            row = result.first()
        _instance_id = str(row[0]) if row else None
    except Exception as e:  # noqa: BLE001
        log.warning("Instance id unavailable: %s", e)
        _instance_id = None

    return _instance_id


def get_instance_id() -> Optional[str]:
    return _instance_id


async def announce_instance() -> None:
    """Report a new deployment to analytics once, then mark it announced."""
    instance_id = _instance_id
    posthog = _load_posthog()
    if not instance_id or posthog is None:
        return

    try:
        engine = get_transactions_engine()
        async with engine.session() as session:
            # Claim the announcement in one statement, so only one API worker sends it.
            result = await session.execute(
                text(
                    "UPDATE instances SET announced_at = now() "
                    "WHERE id = :id AND announced_at IS NULL "
                    "RETURNING created_at, preexisting"
                ),
                {"id": instance_id},
            )
            row = result.first()
            await session.commit()
        if row is None:
            return

        created_at, preexisting = row
        edition = "ee" if is_ee() else "oss"
        posthog.group_identify(
            INSTANCE_GROUP,
            instance_id,
            {
                "edition": edition,
                "created_at": created_at.isoformat(),
                "preexisting": preexisting,
            },
        )
        # An upgraded deployment is registered above but is not a new deployment.
        if preexisting:
            return
        posthog.capture(
            "instance_created",
            distinct_id=instance_id,
            properties={
                "edition": edition,
                "instance_id": instance_id,
                # The instance is not a person: no person profile for this event.
                "$process_person_profile": False,
            },
            groups={INSTANCE_GROUP: instance_id},
        )
    except Exception as e:  # noqa: BLE001
        log.warning("Instance announcement skipped: %s", e)
