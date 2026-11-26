"""Facts about the machine and the deployment, sent with `instance_started` and the
heartbeat. Counts and versions only: no content, no secret and no address but the host
name of `AGENTA_WEB_URL`.

The PostHog library adds the operating system and the Python version to each event
(`$os`, `$os_version`, `$python_version`), so they are not repeated here.
"""

import os
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import urlparse

from pydantic import BaseModel

from oss.src.core.instances.service import (
    get_edition,
    get_instance_kind,
    instances_dao,
)
from oss.src.utils.env import DeploymentMethod, InstanceKind, env
from oss.src.utils.version import get_agenta_version

_MEBIBYTE = 1024 * 1024
# cgroup v2, then cgroup v1. A v1 file holds a huge number when no limit is set.
_MEMORY_LIMIT_FILES = (
    Path("/sys/fs/cgroup/memory.max"),
    Path("/sys/fs/cgroup/memory/memory.limit_in_bytes"),
)
_NO_MEMORY_LIMIT_BYTES = 1 << 60


class RuntimeFacts(BaseModel):
    instance_kind: InstanceKind
    agenta_version: str
    edition: Literal["oss", "ee"]
    deployment_method: Optional[DeploymentMethod]
    # The host name of AGENTA_WEB_URL, without the scheme, port or path.
    instance_host: Optional[str]
    cpu_count: Optional[int]
    memory_mb: Optional[int]
    # The container memory limit, when the API runs under one.
    memory_limit_mb: Optional[int]
    postgres_version: Optional[str]


class InstanceStarted(RuntimeFacts):
    """Every property of `instance_started` but `$groups`, `$process_person_profile`
    and what the PostHog library adds. The telemetry docs page lists these fields."""

    instance_id: str


def get_instance_host() -> Optional[str]:
    return (urlparse(env.agenta.web_url).hostname or "").lower() or None


def _memory_mb() -> Optional[int]:
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") // _MEBIBYTE
    except (AttributeError, OSError, ValueError):
        return None


def _memory_limit_mb() -> Optional[int]:
    for path in _MEMORY_LIMIT_FILES:
        try:
            value = path.read_text().strip()
        except OSError:
            continue
        if not value.isdigit() or int(value) >= _NO_MEMORY_LIMIT_BYTES:
            return None
        return int(value) // _MEBIBYTE
    return None


async def _postgres_version() -> Optional[str]:
    try:
        return await instances_dao.fetch_postgres_version()
    except Exception:  # noqa: BLE001
        return None


async def collect_runtime_facts() -> RuntimeFacts:
    return RuntimeFacts(
        instance_kind=get_instance_kind(),
        agenta_version=get_agenta_version(),
        edition=get_edition(),
        deployment_method=env.telemetry.deployment_method,
        instance_host=get_instance_host(),
        cpu_count=os.cpu_count(),
        memory_mb=_memory_mb(),
        memory_limit_mb=_memory_limit_mb(),
        postgres_version=await _postgres_version(),
    )
