import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence
from urllib.parse import quote
from uuid import UUID

from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.service import AccessService
from oss.src.core.emails.branded import (
    FROM_NAME,
    LOGOS,
    TEXT_FOOTER,
    Detail,
    button_block,
    details_block,
    details_text,
    note_block,
    render_layout,
)
from oss.src.core.memberships.service import MembershipsService
from oss.src.core.notifications.dtos import NotificationKind, RenderedEmail
from oss.src.core.notifications.service import NotificationsService
from oss.src.core.shared.dtos import Windowing
from oss.src.core.triggers.dtos import (
    Settled,
    TriggerDeliveryOutcome as Outcome,
    UnsettledTriggerDelivery,
)
from oss.src.core.triggers.interfaces import TriggersDAOInterface
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

# Older failures open nothing, so the first pass after a deploy sends no backlog.
OPEN_WINDOW = timedelta(hours=1)

HEALTHY_OUTCOMES = (Outcome.COMPLETED, Outcome.WAITING)
RECIPIENT_ROLES = ("owner", "admin")
MEMBERS_PAGE_SIZE = 500

NAME_LIMIT = 80
UNTITLED_AUTOMATION = "Untitled automation"
_STRIPPED_CATEGORIES = ("Cc", "Cf", "Zl", "Zp")


def automation_dedup_key(automation_id: UUID) -> str:
    return f"automation:{automation_id}"


class FailureNotifications:
    def __init__(
        self,
        *,
        triggers_dao: TriggersDAOInterface,
        notifications_service: NotificationsService,
        memberships_service: MembershipsService,
        access_service: AccessService,
    ):
        self.triggers_dao = triggers_dao
        self.notifications_service = notifications_service
        self.memberships_service = memberships_service
        self.access_service = access_service

    async def apply(
        self,
        *,
        delivery: UnsettledTriggerDelivery,
        settled: Settled,
        now: datetime,
    ) -> None:
        """Rules A1 to A5."""
        project_id = delivery.project_id
        automation_id = delivery.schedule_id or delivery.subscription_id
        dedup_key = automation_dedup_key(automation_id)

        if settled.outcome == Outcome.CANCELLED:
            return

        if settled.outcome in HEALTHY_OUTCOMES:
            await self.notifications_service.resolve(
                project_id=project_id,
                dedup_key=dedup_key,
                started_at=delivery.created_at,
            )
            return

        if await self.notifications_service.note_failure(
            project_id=project_id,
            dedup_key=dedup_key,
            started_at=delivery.created_at,
        ):
            return

        if now - settled.ended_at > OPEN_WINDOW:
            return

        await self._open(delivery=delivery, settled=settled, dedup_key=dedup_key)

    async def _open(
        self,
        *,
        delivery: UnsettledTriggerDelivery,
        settled: Settled,
        dedup_key: str,
    ) -> None:
        project_id = delivery.project_id
        automation = await self._read_automation(delivery)
        if automation is None or automation.deleted_at is not None:
            return

        project = await self.memberships_service.fetch_project_summary(
            project_id=project_id
        )
        if project is None:
            return

        recipients = await self.choose_recipients(
            project_id=project_id,
            created_by_id=automation.created_by_id,
            organization_owner_id=project.organization_owner_id,
        )
        if not recipients:
            log.warning(
                "[triggers] a failure notification has no recipient",
                project_id=str(project_id),
                automation_id=str(automation.id),
            )

        started_at = delivery.created_at.astimezone(timezone.utc).isoformat()
        await self.notifications_service.open(
            project_id=project_id,
            kind=NotificationKind.AUTOMATION_FAILING,
            dedup_key=dedup_key,
            data={
                "automation_id": str(automation.id),
                "organization_id": str(project.organization_id),
                "automation_name": automation.name,
                "project_name": project.project_name,
                "failed_at": started_at,
                "last_failed_at": started_at,
                "reason_code": settled.reason_code,
            },
            user_ids=recipients,
        )

    async def _read_automation(self, delivery: UnsettledTriggerDelivery) -> Any:
        if delivery.schedule_id is not None:
            return await self.triggers_dao.fetch_schedule_including_deleted(
                project_id=delivery.project_id,
                schedule_id=delivery.schedule_id,
            )
        return await self.triggers_dao.fetch_subscription_including_deleted(
            project_id=delivery.project_id,
            subscription_id=delivery.subscription_id,
        )

    async def choose_recipients(
        self,
        *,
        project_id: UUID,
        created_by_id: Optional[UUID],
        organization_owner_id: Optional[UUID],
    ) -> List[UUID]:
        """The creator, else the owners and admins, else the organization owner. The first
        step that gives a user who can view automations wins."""
        recipients = await self._can_view(
            project_id, [created_by_id] if created_by_id else []
        )
        if recipients:
            return recipients

        recipients = await self._can_view(
            project_id, await self._owners_and_admins(project_id)
        )
        if recipients:
            return recipients

        return await self._can_view(
            project_id, [organization_owner_id] if organization_owner_id else []
        )

    async def _can_view(
        self,
        project_id: UUID,
        user_ids: Sequence[UUID],
    ) -> List[UUID]:
        allowed = []
        for user_id in user_ids:
            decision = await self.access_service.check_human(
                user_id=user_id,
                project_id=project_id,
                action=Permission.VIEW_TRIGGERS,
            )
            if decision.allowed:
                allowed.append(user_id)
        return allowed

    async def _owners_and_admins(self, project_id: UUID) -> List[UUID]:
        user_ids: List[UUID] = []
        cursor: Optional[UUID] = None
        while True:
            page = await self.memberships_service.query_project_members(
                project_id=project_id,
                windowing=Windowing(next=cursor, limit=MEMBERS_PAGE_SIZE),
            )
            user_ids += [m.user_id for m in page if m.role in RECIPIENT_ROLES]
            if len(page) < MEMBERS_PAGE_SIZE:
                return user_ids
            cursor = page[-1].user_id


_PAUSED = (
    "The automation was paused.",
    "Open the automation, check its agent and who can run it, then turn it on.",
)
_NO_CREDITS = (
    "The run stopped because there are no credits left.",
    "Add credits or add your own model key.",
)
_RUN_ERROR = (
    "The agent's run ended with an error.",
    "Open the automation to see the run and its error.",
)
REASON_CATALOG = {
    "bad_configuration": (
        "The automation could not prepare the run. Its agent or its inputs are not "
        "set correctly.",
        "Open the automation and check its agent and inputs.",
    ),
    "paused_missing_principal": _PAUSED,
    "paused_agent_deleted": _PAUSED,
    "paused_access_denied": _PAUSED,
    "agent_needs_setup": (
        "The agent's model needs setup, so runs are skipped.",
        "Set up the agent's model. The next run starts as usual.",
    ),
    "start_failed": (
        "Agenta could not start the run.",
        "Nothing to change. If it keeps failing, contact support.",
    ),
    "starter_credits_exhausted": _NO_CREDITS,
    "starter_credits_program_paused": _NO_CREDITS,
    "wallet_balance_exhausted": _NO_CREDITS,
}


def normalize_name(name: Optional[str]) -> str:
    cleaned = "".join(
        " " if unicodedata.category(character) in _STRIPPED_CATEGORIES else character
        for character in name or ""
    )
    return re.sub(" +", " ", cleaned).strip()[:NAME_LIMIT]


def render_automation_failing(project_id: UUID, data: Dict[str, Any]) -> RenderedEmail:
    automation_name = normalize_name(data.get("automation_name")) or UNTITLED_AUTOMATION
    project_name = normalize_name(data.get("project_name"))
    failed_at = datetime.fromisoformat(data["failed_at"]).strftime("%Y-%m-%d %H:%M UTC")
    reason, action = REASON_CATALOG.get(data.get("reason_code"), _RUN_ERROR)
    link = "/".join(
        [
            env.agenta.web_url.rstrip("/"),
            "m/w",
            quote(data["organization_id"], safe=""),
            "p",
            quote(str(project_id), safe=""),
            "automations",
            quote(data["automation_id"], safe=""),
        ]
    )
    headline = f'Automation "{automation_name}" is failing'
    details = [Detail("PROJECT", project_name), Detail("FAILING SINCE", failed_at)]
    note = f"{action} You will not get another email about this until it is fixed."

    return RenderedEmail(
        subject=f'Automation "{automation_name}" in {project_name} is failing',
        html=render_layout(
            subject=headline,
            preheader=reason,
            headline=headline,
            description=reason,
            blocks=[
                button_block(label="Open automation", url=link),
                details_block(items=details),
                note_block(note=note),
            ],
        ),
        text=(
            f"{headline}\n\n{reason}\n\nOpen automation: {link}\n\n"
            f"{details_text(items=details)}\n\n{note}\n\n{TEXT_FOOTER}"
        ),
        inline_images=LOGOS,
        from_name=FROM_NAME,
    )
