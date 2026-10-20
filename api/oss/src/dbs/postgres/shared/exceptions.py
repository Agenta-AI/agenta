from typing import Optional
import re

from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects.postgresql.asyncpg import AsyncAdapt_asyncpg_dbapi

from oss.src.utils.logging import get_module_logger
from oss.src.core.shared.exceptions import EntityCreationConflict

log = get_module_logger(__name__)


def check_entity_creation_conflict(
    exception: Exception,
    *,
    entity: Optional[str] = "Entity",
):
    try:
        if not exception:
            return

        if isinstance(exception, IntegrityError):
            original_exception = getattr(exception, "orig", None)

            if original_exception is None:
                return

            if isinstance(original_exception, AsyncAdapt_asyncpg_dbapi.IntegrityError):
                error = str(original_exception)

                match = re.search(r"Key \((?P<keys>.+?)\)=\((?P<vals>.+?)\)", error)

                if not match:
                    return

                keys = match.group("keys").split(", ")
                vals = match.group("vals").split(", ")

                conflict = dict(zip(keys, vals))

                if "project_id" in conflict:
                    del conflict["project_id"]

                raise EntityCreationConflict(
                    entity=entity,
                    conflict=conflict,
                )

    except Exception as e:  # pylint: disable=bare-except
        if not isinstance(e, EntityCreationConflict):
            return

        raise


# Postgres reports `lock_timeout` expiry as `lock_not_available`.
LOCK_NOT_AVAILABLE_SQLSTATE = "55P03"


def is_lock_timeout(exception: Optional[BaseException]) -> bool:
    """Whether an exception is an expired `lock_timeout`.

    The SQLSTATE travels on the driver error that SQLAlchemy wraps, so walk the chain
    rather than trusting one wrapper's shape.
    """
    seen = exception
    for _ in range(4):
        if seen is None:
            return False
        if getattr(seen, "sqlstate", None) == LOCK_NOT_AVAILABLE_SQLSTATE:
            return True
        seen = getattr(seen, "orig", None) or getattr(seen, "__cause__", None)
    return False
