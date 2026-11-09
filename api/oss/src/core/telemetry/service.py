import asyncio
from functools import lru_cache
from typing import Any, Dict, Optional
from uuid import UUID, uuid5

from posthog import Posthog

from oss.src.core.instances.service import get_instance_id, instances_dao
from oss.src.core.telemetry.dtos import InstanceTelemetry, TelemetryStatus
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

TELEMETRY_DOCS_URL = "https://docs.agenta.ai/self-host/telemetry"

INSTANCE_INSTALLED_EVENT = "instance_installed"
# Exactly what the install ping sends besides the instance id. The docs page lists it.
INSTANCE_INSTALLED_PROPERTIES = {"$geoip_disable": True, "$ip": ""}
INSTALL_PING_TIMEOUT_SECONDS = 5

# What the PostHog library adds to every event. Instance events send only their own
# properties, so these are dropped before the send.
_LIBRARY_PROPERTIES = (
    "$lib",
    "$lib_version",
    "$python_runtime",
    "$python_version",
    "$os",
    "$os_version",
    "$os_distro",
    "$is_server",
)


async def telemetry_status() -> TelemetryStatus:
    if env.stripe.enabled:
        return TelemetryStatus(enabled=True, reason="cloud")
    if env.telemetry.enabled_set:
        return TelemetryStatus(enabled=env.telemetry.enabled, reason="switch")
    return TelemetryStatus(enabled=env.telemetry.enabled, reason="default")


async def telemetry_enabled() -> bool:
    """The one gate for PostHog events other than the install ping."""

    return (await telemetry_status()).enabled


async def distinct_id_for(user_id: UUID, email: str) -> str:
    if env.stripe.enabled:
        return email
    return f"{await get_instance_id()}:{user_id}"


async def instance_telemetry_for(user_id: UUID, email: str) -> InstanceTelemetry:
    """What the browser needs to send the same identity as the API."""

    if not await telemetry_enabled():
        return InstanceTelemetry(enabled=False)
    if env.stripe.enabled:
        return InstanceTelemetry(enabled=True, distinct_id=email)
    instance_id = str(await get_instance_id())
    return InstanceTelemetry(
        enabled=True,
        distinct_id=await distinct_id_for(user_id, email),
        groups={"instance": instance_id},
    )


def _without_library_properties(message: Dict[str, Any]) -> Dict[str, Any]:
    properties = message.get("properties") or {}
    for key in _LIBRARY_PROPERTIES:
        properties.pop(key, None)
    return message


@lru_cache(maxsize=None)
def _sync_client(timeout: int) -> Posthog:
    return Posthog(
        project_api_key=env.posthog.api_key,
        host=env.posthog.api_url,
        sync_mode=True,
        timeout=timeout,
        before_send=_without_library_properties,
    )


async def capture(
    event: str,
    distinct_id: str,
    properties: Dict[str, Any],
    *,
    uuid: Optional[UUID] = None,
    timeout: int = INSTALL_PING_TIMEOUT_SECONDS,
) -> None:
    """Send one event and return once PostHog accepted it; raise when it did not.

    For instance events only (install ping, telemetry heartbeat). Per-user events use
    the queued client from `_load_posthog()`. A fixed `uuid` lets PostHog drop a copy.
    """

    sent = await asyncio.to_thread(
        _sync_client(timeout).capture,
        event,
        distinct_id=distinct_id,
        properties=properties,
        uuid=uuid,
    )
    # The client catches its own send errors and returns None instead of the event uuid.
    if sent is None:
        raise RuntimeError(f"PostHog did not accept {event}")


async def group_identify(
    group_type: str,
    group_key: str,
    properties: Dict[str, Any],
    *,
    timeout: int,
) -> None:
    """Set a PostHog group's properties and return once PostHog accepted them; raise
    when it did not."""

    sent = await asyncio.to_thread(
        _sync_client(timeout).group_identify,
        group_type,
        group_key,
        properties,
    )
    # The client catches its own send errors and returns None instead of the event uuid.
    if sent is None:
        raise RuntimeError(f"PostHog did not accept the {group_type} group properties")


async def instance_groups() -> Dict[str, str]:
    """The PostHog groups of a self-hosted event. Cloud events carry none."""

    return {"instance": str(await get_instance_id())}


async def send_install_ping() -> None:
    """Send `instance_installed` once per instance, whatever the switch says.

    The row stays locked until PostHog accepts the event, so one container sends it.
    """

    if env.stripe.enabled:
        return

    try:
        async with instances_dao.lock_unsent_install_ping() as instance_id:
            if instance_id is None:
                return
            await capture(
                INSTANCE_INSTALLED_EVENT,
                str(instance_id),
                dict(INSTANCE_INSTALLED_PROPERTIES),
                uuid=uuid5(instance_id, INSTANCE_INSTALLED_EVENT),
                timeout=INSTALL_PING_TIMEOUT_SECONDS,
            )
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "Install ping not sent; the next start tries again",
            reason=type(exc).__name__,
        )


_background_tasks: set[asyncio.Task] = set()


def schedule_install_ping() -> None:
    """Send the install ping without holding up the caller."""

    task = asyncio.create_task(send_install_ping())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


_STATUS_REASONS = {
    "cloud": "Agenta Cloud",
    "default": "on by default",
    "switch": "AGENTA_TELEMETRY_ENABLED",
}


async def log_telemetry_status() -> None:
    status = await telemetry_status()
    if status.enabled:
        log.info(
            f"Telemetry is on ({_STATUS_REASONS[status.reason]}). "
            f"What is sent and how to turn it off: {TELEMETRY_DOCS_URL}"
        )
    else:
        log.info(
            "Telemetry is off (AGENTA_TELEMETRY_ENABLED=false). The install ping "
            f"still runs once. What is sent: {TELEMETRY_DOCS_URL}"
        )
