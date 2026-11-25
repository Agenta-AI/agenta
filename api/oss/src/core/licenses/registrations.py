"""Registration: ask Agenta for a free registration key, sent to an email.

Agenta signs a key with the plan `self_hosted_registered` and emails it with an
activation link back to this instance. The instance stores nothing.
"""

from typing import Optional
from uuid import UUID

import httpx

from oss.src.core.licenses.types import RegistrationFailed
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

REGISTRATION_URL = "https://agenta.ai/api/license-registrations"


async def _instance_id() -> UUID:
    # #8237 adds `get_instance_id`; hoist this import when it lands.
    from oss.src.core.instances.service import get_instance_id  # noqa: PLC0415

    return await get_instance_id()


def _instance_kind() -> str:
    # #8237 adds `get_instance_kind`; hoist this import when it lands.
    from oss.src.core.instances.service import get_instance_kind  # noqa: PLC0415

    return get_instance_kind()


def _agenta_version() -> str:
    # #8240 adds `get_agenta_version`; hoist this import when it lands.
    from oss.src.utils.version import get_agenta_version  # noqa: PLC0415

    return get_agenta_version()


async def create_registration(
    *,
    email: str,
    user_id: UUID,
    product_updates: bool,
    survey: Optional[dict[str, str]] = None,
) -> None:
    """`user_id` is the signed-in admin; Agenta links their analytics person to the
    email. `survey` holds the setup answers as choice labels."""
    try:
        payload = {
            "email": email,
            "instance_id": str(await _instance_id()),
            # production, development, ci or test, so Agenta can filter out its own
            # test stacks.
            "instance_kind": _instance_kind(),
            "agenta_version": _agenta_version(),
            "web_url": env.agenta.web_url,
            "user_id": str(user_id),
            "product_updates": product_updates,
            "survey": survey or {},
        }
    except ImportError as error:
        # Until the instance id and version modules ship in this image.
        log.error("[licenses] registration is not wired", module=error.name)
        raise RegistrationFailed() from None

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(REGISTRATION_URL, json=payload)
        response.raise_for_status()
    except httpx.HTTPError as error:
        log.warning(
            "[licenses] registration request failed", error=type(error).__name__
        )
        raise RegistrationFailed() from None
