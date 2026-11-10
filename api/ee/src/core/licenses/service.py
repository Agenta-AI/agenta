"""The instance license and the plan it gives every organization when Stripe is off.

Plan order: Stripe (cloud, handled by the callers), then a valid license key, then
`self_hosted_community`. A key in `AGENTA_LICENSE_KEY` takes priority over a key added
in the app.
"""

from functools import lru_cache
from typing import Optional
from uuid import UUID

from oss.src.utils.caching import get_cache, invalidate_cache, set_cache
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

from ee.src.core.licenses.interfaces import LicensesDAOInterface
from ee.src.core.licenses.keys import parse_license_key
from ee.src.core.licenses.types import (
    InvalidLicenseKey,
    LicenseKey,
    LicenseKeyInEnvironment,
    LicenseState,
)
from ee.src.dbs.postgres.licenses.dao import LicensesDAO

log = get_module_logger(__name__)

CACHE_NAMESPACE = "licenses:active"
CACHE_KEY = "active"
CACHE_TTL = 5 * 60


class LicensesService:
    def __init__(self, *, licenses_dao: LicensesDAOInterface):
        self.licenses_dao = licenses_dao

    async def read_state(self) -> LicenseState:
        # The environment key belongs to this process, so it never goes in the shared
        # cache: a cached state would outlive a restart with another key.
        if env.license.key:
            return _environment_state(env.license.key)

        cached = await get_cache(namespace=CACHE_NAMESPACE, key=CACHE_KEY)
        if cached is not None:
            return LicenseState.model_validate(cached)

        state = await self._load_stored_state()
        await set_cache(
            namespace=CACHE_NAMESPACE,
            key=CACHE_KEY,
            value=state.model_dump(mode="json"),
            ttl=CACHE_TTL,
        )
        return state

    async def active_license(self) -> Optional[LicenseKey]:
        return (await self.read_state()).active_license()

    async def instance_plan(self) -> str:
        return (await self.read_state()).plan

    async def activate(self, *, key: str, user_id: UUID) -> LicenseState:
        if env.license.key:
            raise LicenseKeyInEnvironment()

        license_key = parse_license_key(key)
        if license_key.is_expired():
            raise InvalidLicenseKey("expired")

        await self.licenses_dao.replace(
            key_id=license_key.key_id,
            key=key.strip(),
            created_by_id=user_id,
        )
        await invalidate_cache(namespace=CACHE_NAMESPACE, key=CACHE_KEY)

        log.info("[licenses] license key %s added", license_key.key_id)

        return LicenseState(source="database", license=license_key)

    async def _load_stored_state(self) -> LicenseState:
        stored = await self.licenses_dao.read()
        if stored is None:
            return LicenseState()

        return LicenseState(
            source="database",
            license=_parse_or_none(stored.key, origin="the stored key"),
        )


@lru_cache(maxsize=1)
def _environment_state(key: str) -> LicenseState:
    return LicenseState(
        source="environment",
        license=_parse_or_none(key, origin="AGENTA_LICENSE_KEY"),
    )


def _parse_or_none(key: str, *, origin: str) -> Optional[LicenseKey]:
    try:
        return parse_license_key(key)
    except InvalidLicenseKey as e:
        log.warning("[licenses] %s is not a valid license key (%s)", origin, e.reason)
        return None


_service: Optional[LicensesService] = None


def get_licenses_service() -> LicensesService:
    global _service
    if _service is None:
        _service = LicensesService(licenses_dao=LicensesDAO())
    return _service


async def active_license() -> Optional[LicenseKey]:
    """The license key in force: valid, not refused, not expired."""
    return await get_licenses_service().active_license()


async def instance_plan() -> str:
    """The plan of every organization on an instance without Stripe."""
    return await get_licenses_service().instance_plan()
