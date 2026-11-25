from ipaddress import ip_address
from typing import Literal, Optional
from urllib.parse import urlparse
from uuid import UUID

from oss.src.core.instances.types import InstanceMissing
from oss.src.dbs.postgres.instances.dao import InstancesDAO
from oss.src.utils.common import is_ee
from oss.src.utils.env import InstanceKind, env

instances_dao = InstancesDAO()

# The migration inserts the one row and nothing changes it, so one read per process.
_instance_id: Optional[UUID] = None


async def get_instance_id() -> UUID:
    global _instance_id

    if _instance_id is None:
        instance_id = await instances_dao.fetch_instance_id()
        if instance_id is None:
            raise InstanceMissing()
        _instance_id = instance_id

    return _instance_id


def _is_development_host(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        address = ip_address(host)
    except ValueError:
        return False
    return address.is_loopback or address.is_private


def get_instance_kind() -> InstanceKind:
    """AGENTA_TELEMETRY_INSTANCE_KIND when set, else detected from CI and the web URL."""

    if env.telemetry.instance_kind:
        return env.telemetry.instance_kind
    if env.telemetry.ci:
        return "ci"
    host = (urlparse(env.agenta.web_url).hostname or "").lower()
    if _is_development_host(host):
        return "development"
    return "production"


def get_edition() -> Literal["oss", "ee"]:
    # Every shipped image has the ee code since one image (#8549); AGENTA_LICENSE is gone.
    return "ee" if is_ee() else "oss"
