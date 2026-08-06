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
