"""The telemetry heartbeat: one `instance_heartbeat` event per 12 hours from a
self-hosted instance, with counts and no content. Not the liveness file in
`utils/heartbeat.py`."""

from datetime import datetime, timezone
from typing import List, Literal, Optional, Tuple
from uuid import uuid5

from pydantic import BaseModel, Field, ValidationError, field_validator

from oss.src.core.instances.service import (
    get_edition,
    get_instance_kind,
    instances_dao,
)
from oss.src.core.telemetry import service as telemetry
from oss.src.utils.common import is_ee
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger
from oss.src.utils.version import get_agenta_version

log = get_module_logger(__name__)

INSTANCE_HEARTBEAT_EVENT = "instance_heartbeat"
HEARTBEAT_TIMEOUT_SECONDS = 10
MAX_USER_DOMAINS = 100
COMMUNITY_PLAN = "self_hosted_community"

HeartbeatReason = Literal["sent", "not_due", "disabled", "cloud", "failed"]


class UserDomain(BaseModel):
    domain: str
    users: int

    @field_validator("domain")
    @classmethod
    def _domain_only(cls, value: str) -> str:
        if not value or "@" in value or any(char.isspace() for char in value):
            raise ValueError("not an email domain")
        return value


class InstanceHeartbeat(BaseModel):
    """Every property of `instance_heartbeat` but `$groups`. The telemetry docs page
    lists these fields, and a unit test keeps the two the same."""

    instance_id: str
    instance_kind: Literal["production", "development", "ci"]
    agenta_version: str
    edition: Literal["oss", "ee"]
    deployment_method: Optional[Literal["compose", "helm", "railway"]]
    plan: str
    license_key_id: Optional[str]
    total_organizations: int
    total_projects: int
    total_users: int
    total_workflows: int
    window_start: str
    window_end: str
    # Null when the count runs past its statement timeout on a large database.
    window_spans: Optional[int]
    window_evaluation_runs: Optional[int]
    window_agent_turns: Optional[int]
    user_domains: List[UserDomain] = Field(max_length=MAX_USER_DOMAINS)


# The group properties PostHog keeps on the `instance` group.
GROUP_PROPERTIES = (
    "instance_kind",
    "agenta_version",
    "edition",
    "deployment_method",
    "plan",
    "total_organizations",
    "total_projects",
    "total_users",
    "total_workflows",
)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def user_domains_from(rows: List[Tuple[str, int]]) -> List[UserDomain]:
    """Keep well-formed domains only."""

    domains = []
    for domain, users in rows:
        try:
            domains.append(UserDomain(domain=domain, users=users))
        except ValidationError:
            continue
    return domains


async def _plan_and_license_key_id() -> Tuple[str, Optional[str]]:
    if not is_ee():
        return COMMUNITY_PLAN, None

    try:
        from ee.src.core.licenses.service import (  # noqa: PLC0415
            active_license,
            instance_plan,
        )
    except ImportError:
        # An EE image without the license module has no key: the plan with no key.
        return COMMUNITY_PLAN, None

    license_key = await active_license()
    return (
        await instance_plan(),
        str(license_key.key_id) if license_key is not None else None,
    )


async def collect_heartbeat(
    *,
    instance_id: str,
    window_start: datetime,
    window_end: datetime,
) -> InstanceHeartbeat:
    (
        total_organizations,
        total_projects,
        total_users,
        total_workflows,
        project_ids,
    ) = await instances_dao.count_totals()
    window_evaluation_runs = await instances_dao.count_window_evaluation_runs(
        window_start=window_start,
        window_end=window_end,
    )
    window_agent_turns = await instances_dao.count_window_session_turns(
        window_start=window_start,
        window_end=window_end,
    )
    window_spans = await instances_dao.count_window_spans(
        project_ids=project_ids,
        window_start=window_start,
        window_end=window_end,
    )
    domain_rows = await instances_dao.top_email_domains(limit=MAX_USER_DOMAINS)
    plan, license_key_id = await _plan_and_license_key_id()

    return InstanceHeartbeat(
        instance_id=instance_id,
        instance_kind=get_instance_kind(),
        agenta_version=get_agenta_version(),
        edition=get_edition(),
        deployment_method=env.telemetry.deployment_method,
        plan=plan,
        license_key_id=license_key_id,
        total_organizations=total_organizations,
        total_projects=total_projects,
        total_users=total_users,
        total_workflows=total_workflows,
        window_start=_iso(window_start),
        window_end=_iso(window_end),
        window_spans=window_spans,
        window_evaluation_runs=window_evaluation_runs,
        window_agent_turns=window_agent_turns,
        user_domains=user_domains_from(domain_rows),
    )


async def send_heartbeat() -> HeartbeatReason:
    """Send the heartbeat when 12 hours have passed since the last one.

    The counts are collected before the row lock, so the lock covers only the send.
    One container sends: the others skip the locked row. A failed send of the event
    or of the group properties rolls back, so the next hourly run covers the same
    window again; the fixed event uuid lets PostHog drop the copy.
    """

    if env.stripe.enabled:
        return "cloud"
    if not await telemetry.telemetry_enabled():
        return "disabled"

    try:
        due = await instances_dao.fetch_due_heartbeat_window()
        if due is None:
            return "not_due"
        instance_id, heartbeat_sent_at, created_at, now = due
        window_start = heartbeat_sent_at or created_at

        heartbeat = await collect_heartbeat(
            instance_id=str(instance_id),
            window_start=window_start,
            window_end=now,
        )
        properties = {
            **heartbeat.model_dump(mode="json"),
            "$groups": {"instance": heartbeat.instance_id},
        }

        async with instances_dao.lock_due_heartbeat(
            heartbeat_sent_at=heartbeat_sent_at,
            window_end=now,
        ) as locked:
            if not locked:
                return "not_due"
            await telemetry.capture(
                INSTANCE_HEARTBEAT_EVENT,
                heartbeat.instance_id,
                properties,
                uuid=uuid5(instance_id, heartbeat.window_start),
                timeout=HEARTBEAT_TIMEOUT_SECONDS,
            )
            await telemetry.group_identify(
                "instance",
                heartbeat.instance_id,
                heartbeat.model_dump(mode="json", include=set(GROUP_PROPERTIES)),
                timeout=HEARTBEAT_TIMEOUT_SECONDS,
            )
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "Telemetry heartbeat not sent; the next run tries again",
            reason=type(exc).__name__,
            error=str(exc),
        )
        return "failed"

    return "sent"
