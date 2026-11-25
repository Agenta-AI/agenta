"""The telemetry heartbeat: one `instance_heartbeat` event per 6 hours from a
self-hosted instance, with counts, machine facts and configuration flags, and no
content. Not the liveness file in `utils/heartbeat.py`."""

import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional, Tuple
from uuid import uuid5

from pydantic import BaseModel, Field, ValidationError, field_validator

from oss.src.core.instances.service import instances_dao
from oss.src.core.telemetry import service as telemetry
from oss.src.core.telemetry.runtime import RuntimeFacts, collect_runtime_facts
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

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


class LicenseDetail(BaseModel):
    plan: str
    license_key_id: Optional[str]
    license_expires_at: Optional[str]
    license_days_left: Optional[int]
    license_seats: Optional[int]


class ConfigFlags(BaseModel):
    """Whether a feature is set up. Booleans only, never a value."""

    email_configured: bool
    sso_configured: bool
    social_login_configured: bool
    otel_export_configured: bool
    composio_configured: bool
    llm_gateway_enabled: bool
    # The time zone name of the API process, such as "UTC".
    timezone: Optional[str]


class InstanceHeartbeat(ConfigFlags, LicenseDetail, RuntimeFacts):
    """Every property of `instance_heartbeat` but `$groups` and what the PostHog
    library adds. The telemetry docs page lists these fields, and a unit test keeps
    the two the same."""

    instance_id: str
    total_organizations: int
    total_projects: int
    total_users: int
    total_workflows: int
    # Null when the count runs past its statement timeout on a large database.
    total_prompts: Optional[int]
    total_agents: Optional[int]
    total_evaluators: Optional[int]
    total_snippets: Optional[int]
    total_api_keys: Optional[int]
    # Organization members by role, such as {"owner": 1, "editor": 4}.
    users_by_role: Optional[Dict[str, int]]
    window_start: str
    window_end: str
    # Null when the count runs past its statement timeout on a large database.
    window_spans: Optional[int]
    window_traces: Optional[int]
    window_annotations: Optional[int]
    window_evaluation_runs: Optional[int]
    # Evaluation runs created in the window, by their status now.
    window_evaluation_runs_by_status: Optional[Dict[str, int]]
    window_evaluation_scenarios: Optional[int]
    window_agent_turns: Optional[int]
    # Agent turns that ended in the window, by outcome (completed, failed, ...).
    window_agent_turns_by_outcome: Optional[Dict[str, int]]
    window_revisions: Optional[int]
    window_deployments: Optional[int]
    window_testsets: Optional[int]
    window_testcases: Optional[int]
    user_domains: List[UserDomain] = Field(max_length=MAX_USER_DOMAINS)


# The group properties PostHog keeps on the `instance` group.
GROUP_PROPERTIES = (
    "instance_kind",
    "agenta_version",
    "edition",
    "deployment_method",
    "instance_host",
    "postgres_version",
    "plan",
    "license_expires_at",
    "license_seats",
    "total_organizations",
    "total_projects",
    "total_users",
    "total_workflows",
    "total_prompts",
    "total_agents",
    "total_evaluators",
    "total_snippets",
    "total_api_keys",
)

# The enterprise sign-in providers. The others are social logins.
_SSO_PROVIDERS = ("okta", "azure_ad", "boxy_saml", "google_workspaces")
_SOCIAL_PROVIDERS = (
    "apple",
    "bitbucket",
    "discord",
    "facebook",
    "github",
    "gitlab",
    "google",
    "linkedin",
    "twitter",
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


def _license_detail_from(license_key: Any, now: datetime) -> LicenseDetail:
    """The plan and what the key says about it. Never the key itself."""

    if license_key is None:
        return LicenseDetail(
            plan=COMMUNITY_PLAN,
            license_key_id=None,
            license_expires_at=None,
            license_days_left=None,
            license_seats=None,
        )
    expires_at = license_key.expires_at
    return LicenseDetail(
        plan=license_key.plan,
        license_key_id=str(license_key.key_id),
        license_expires_at=_iso(expires_at) if expires_at else None,
        license_days_left=(expires_at - now).days if expires_at else None,
        license_seats=license_key.seats,
    )


async def _config_flags() -> ConfigFlags:
    identity = env.identity
    return ConfigFlags(
        email_configured=env.smtp.enabled or env.sendgrid.enabled,
        sso_configured=any(getattr(identity, name).enabled for name in _SSO_PROVIDERS)
        or await instances_dao.has_organization_sso_providers(),
        social_login_configured=any(
            getattr(identity, name).enabled for name in _SOCIAL_PROVIDERS
        ),
        otel_export_configured=bool(
            env.agenta.logging.otlp_enabled or env.agenta.server_tracing.endpoint
        ),
        composio_configured=env.composio.enabled,
        llm_gateway_enabled=env.llm_gateway.enabled,
        timezone=time.tzname[0] or None,
    )


async def collect_heartbeat(
    *,
    instance_id: str,
    window_start: datetime,
    window_end: datetime,
) -> InstanceHeartbeat:
    window = {"window_start": window_start, "window_end": window_end}
    (
        total_organizations,
        total_projects,
        total_users,
        total_workflows,
        project_ids,
    ) = await instances_dao.count_totals()
    total_prompts, total_agents, total_evaluators, total_snippets = (
        await instances_dao.count_workflow_kinds() or (None, None, None, None)
    )
    window_traces, window_annotations = await instances_dao.count_window_traces(
        project_ids=project_ids, **window
    ) or (None, None)
    runs_by_status = await instances_dao.count_window_evaluation_runs_by_status(
        **window
    )
    domain_rows = await instances_dao.top_email_domains(limit=MAX_USER_DOMAINS)

    return InstanceHeartbeat(
        instance_id=instance_id,
        **(await collect_runtime_facts()).model_dump(),
        **_license_detail_from(
            await telemetry.active_license(), window_end
        ).model_dump(),
        **(await _config_flags()).model_dump(),
        total_organizations=total_organizations,
        total_projects=total_projects,
        total_users=total_users,
        total_workflows=total_workflows,
        total_prompts=total_prompts,
        total_agents=total_agents,
        total_evaluators=total_evaluators,
        total_snippets=total_snippets,
        total_api_keys=await instances_dao.count_api_keys(),
        users_by_role=await instances_dao.count_users_by_role(),
        window_start=_iso(window_start),
        window_end=_iso(window_end),
        window_spans=await instances_dao.count_window_spans(
            project_ids=project_ids, **window
        ),
        window_traces=window_traces,
        window_annotations=window_annotations,
        window_evaluation_runs=(
            sum(runs_by_status.values()) if runs_by_status is not None else None
        ),
        window_evaluation_runs_by_status=runs_by_status,
        window_evaluation_scenarios=(
            await instances_dao.count_window_evaluation_scenarios(**window)
        ),
        window_agent_turns=await instances_dao.count_window_session_turns(**window),
        window_agent_turns_by_outcome=(
            await instances_dao.count_window_agent_turns_by_outcome(**window)
        ),
        window_revisions=await instances_dao.count_window_workflow_revisions(**window),
        window_deployments=await instances_dao.count_window_environment_revisions(
            **window
        ),
        window_testsets=await instances_dao.count_window_testsets(**window),
        window_testcases=await instances_dao.count_window_testcases(**window),
        user_domains=user_domains_from(domain_rows),
    )


async def send_heartbeat() -> HeartbeatReason:
    """Send the heartbeat when 6 hours have passed since the last one.

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
