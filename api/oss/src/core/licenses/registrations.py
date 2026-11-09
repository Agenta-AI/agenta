"""Registration: ask Agenta for a free registration key, sent to an email.

Agenta signs a key with the plan `self_hosted_registered` and emails it with an
activation link back to this instance. The instance stores nothing.
"""

from uuid import UUID

import httpx

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

REGISTRATION_URL = "https://agenta.ai/api/license-registrations"


class RegistrationFailed(Exception):
    pass


async def _instance_id() -> UUID:
    # Part 1 of this change adds `get_instance_id`; hoist this import when it lands.
    from oss.src.core.instances.service import get_instance_id  # noqa: PLC0415

    return await get_instance_id()


def _agenta_version() -> str:
    # Part 5 of this change adds `get_agenta_version`; hoist this import when it lands.
    from oss.src.utils.version import get_agenta_version  # noqa: PLC0415

    return get_agenta_version()


async def request_registration(email: str) -> None:
    payload = {
        "email": email,
        "instance_id": str(await _instance_id()),
        "agenta_version": _agenta_version(),
        "web_url": env.agenta.web_url,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(REGISTRATION_URL, json=payload)
        response.raise_for_status()
    except httpx.HTTPError as error:
        log.warning(
            "[licenses] registration request failed", error=type(error).__name__
        )
        raise RegistrationFailed() from None
