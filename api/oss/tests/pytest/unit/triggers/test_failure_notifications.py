"""Rules A1 to A5, recipients, and the `automation_failing` email."""

import html as html_lib
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from oss.src.core.access.permissions.types import Permission
from oss.src.core.memberships.dtos import ProjectMemberProfile
from oss.src.core.notifications.dtos import (
    NotificationDeliveryState,
    NotificationState,
)
from oss.src.core.notifications.service import NotificationsService
from oss.src.core.triggers.dtos import Settled, TriggerDeliveryOutcome as Outcome
from oss.src.core.triggers.failure_notifications import (
    FailureNotifications,
    automation_dedup_key,
    normalize_name,
    plain_error_message,
    render_automation_failing,
)
from oss.src.utils.env import env
from oss.tests.pytest.unit.triggers._failure_fakes import (
    NOW,
    FakeNotificationsDAO,
    make_delivery,
    minutes_ago,
)

CREATOR = UUID("00000000-0000-0000-0000-00000000000a")
ORGANIZATION_OWNER = UUID("00000000-0000-0000-0000-00000000000b")
ORGANIZATION_ID = UUID("00000000-0000-0000-0000-00000000000c")
PROJECT_ID = UUID("00000000-0000-0000-0000-00000000000d")
AUTOMATION_ID = UUID("00000000-0000-0000-0000-00000000000e")

FAILED = Outcome.FAILED


class Harness:
    def __init__(self, *, automation="live", members=(), allowed=None):
        self.dao = FakeNotificationsDAO()
        self.service = NotificationsService(
            notifications_dao=self.dao,
            memberships_service=MagicMock(),
            template=MagicMock(),
        )
        self.triggers_dao = MagicMock()
        self.triggers_dao.fetch_schedule_including_deleted = AsyncMock(
            return_value={
                "live": SimpleNamespace(
                    id=AUTOMATION_ID,
                    name="Daily report",
                    created_by_id=CREATOR,
                    deleted_at=None,
                ),
                "deleted": SimpleNamespace(
                    id=AUTOMATION_ID,
                    name="Daily report",
                    created_by_id=CREATOR,
                    deleted_at=NOW,
                ),
                "missing": None,
            }[automation]
        )
        memberships = MagicMock()
        memberships.fetch_project_summary = AsyncMock(
            return_value=SimpleNamespace(
                organization_id=ORGANIZATION_ID,
                organization_owner_id=ORGANIZATION_OWNER,
                project_name="Growth",
            )
        )
        memberships.query_project_members = AsyncMock(return_value=list(members))
        self.memberships = memberships
        allowed = {CREATOR} if allowed is None else set(allowed)
        access = MagicMock()
        access.check_human = AsyncMock(
            side_effect=lambda *, user_id, project_id, action: SimpleNamespace(
                allowed=user_id in allowed and action == Permission.VIEW_TRIGGERS
            )
        )
        self.rules = FailureNotifications(
            triggers_dao=self.triggers_dao,
            notifications_service=self.service,
            memberships_service=memberships,
            access_service=access,
        )

    async def run(self, outcome, *, started, ended=None, reason_code="start_failed"):
        delivery = make_delivery(
            "202",
            project_id=PROJECT_ID,
            schedule_id=AUTOMATION_ID,
            created_at=minutes_ago(started),
        )
        settled = Settled(
            outcome=outcome,
            reason_code=reason_code if outcome in (FAILED, Outcome.SKIPPED) else None,
            ended_at=minutes_ago(started if ended is None else ended),
        )
        await self.rules.apply(delivery=delivery, settled=settled, now=NOW)

    async def fix(self):
        await self.service.resolve(
            project_id=PROJECT_ID, dedup_key=automation_dedup_key(AUTOMATION_ID)
        )

    @property
    def states(self):
        return [row["state"] for row in self.dao.notifications]


OPEN = NotificationState.OPEN
RESOLVED = NotificationState.RESOLVED


async def test_the_first_failure_opens_one_notification_for_the_creator():
    harness = Harness()

    await harness.run(FAILED, started=10)

    [row] = harness.dao.notifications
    assert row["dedup_key"] == f"automation:{AUTOMATION_ID}"
    assert row["data"] == {
        "automation_id": str(AUTOMATION_ID),
        "organization_id": str(ORGANIZATION_ID),
        "automation_name": "Daily report",
        "project_name": "Growth",
        "failed_at": "2026-11-05T11:50:00+00:00",
        "last_failed_at": "2026-11-05T11:50:00+00:00",
        "reason_code": "start_failed",
        "error_message": "",
    }
    assert [delivery["user_id"] for delivery in harness.dao.deliveries] == [CREATOR]


async def test_a_skipped_run_opens_too():
    harness = Harness()

    await harness.run(Outcome.SKIPPED, started=10, reason_code="agent_needs_setup")

    assert harness.states == [OPEN]


async def test_ten_failures_keep_one_notification_and_move_last_failed_at():
    harness = Harness()

    for started in range(30, 20, -1):
        await harness.run(FAILED, started=started)

    [row] = harness.dao.notifications
    assert row["data"]["failed_at"] == "2026-11-05T11:30:00+00:00"
    assert row["data"]["last_failed_at"] == "2026-11-05T11:39:00+00:00"
    assert len(harness.dao.deliveries) == 1
    harness.triggers_dao.fetch_schedule_including_deleted.assert_awaited_once()


@pytest.mark.parametrize(
    "outcome", [Outcome.CANCELLED, Outcome.COMPLETED, Outcome.WAITING]
)
async def test_a_run_that_did_not_fail_opens_nothing(outcome):
    harness = Harness()

    await harness.run(outcome, started=10)

    assert harness.dao.notifications == []


@pytest.mark.parametrize("outcome", [Outcome.COMPLETED, Outcome.WAITING])
async def test_a_healthy_run_resolves(outcome):
    harness = Harness()
    await harness.run(FAILED, started=10)

    await harness.run(outcome, started=5)

    assert harness.states == [RESOLVED]


async def test_a_cancelled_run_keeps_the_notification_open():
    harness = Harness()
    await harness.run(FAILED, started=10)

    await harness.run(Outcome.CANCELLED, started=5)

    assert harness.states == [OPEN]


async def test_an_older_run_that_succeeds_after_a_newer_failure_resolves_nothing():
    harness = Harness()
    await harness.run(FAILED, started=50)

    await harness.run(Outcome.COMPLETED, started=60)

    assert harness.states == [OPEN]


async def test_a_reclaimed_start_keeps_its_time_and_still_resolves():
    harness = Harness()
    await harness.run(FAILED, started=10)

    await harness.run(Outcome.COMPLETED, started=10)

    assert harness.states == [RESOLVED]


async def test_fail_fix_fail_opens_two():
    harness = Harness()
    await harness.run(FAILED, started=10)
    await harness.fix()

    await harness.run(FAILED, started=5)

    assert harness.states == [RESOLVED, OPEN]
    assert len(harness.dao.deliveries) == 2


async def test_a_run_from_before_the_fix_that_fails_after_it_opens_a_new_one():
    harness = Harness()
    await harness.run(FAILED, started=5)
    await harness.fix()

    await harness.run(FAILED, started=20, ended=1)

    assert harness.states == [RESOLVED, OPEN]


async def test_a_failure_older_than_one_hour_opens_nothing():
    harness = Harness()

    await harness.run(FAILED, started=361)

    assert harness.dao.notifications == []
    harness.triggers_dao.fetch_schedule_including_deleted.assert_not_awaited()


async def test_a_failure_of_exactly_one_hour_still_opens():
    harness = Harness()

    await harness.run(FAILED, started=60)

    assert harness.states == [OPEN]


async def test_an_old_failure_still_moves_an_open_notification():
    harness = Harness()
    await harness.run(FAILED, started=200, ended=10)

    await harness.run(FAILED, started=100, ended=90)

    [row] = harness.dao.notifications
    assert row["data"]["last_failed_at"] == "2026-11-05T10:20:00+00:00"


@pytest.mark.parametrize("automation", ["deleted", "missing"])
async def test_a_gone_automation_opens_nothing(automation):
    harness = Harness(automation=automation)

    await harness.run(FAILED, started=10)

    assert harness.dao.notifications == []


async def test_a_notification_opened_and_resolved_in_one_page_sends_nothing(
    monkeypatch,
):
    harness = Harness()
    monkeypatch.setattr(env.smtp, "host", "smtp.example.com")
    monkeypatch.setattr(env.smtp, "port", 587)
    monkeypatch.setattr(env.smtp, "from_email", "from@example.com")
    await harness.run(FAILED, started=10)
    await harness.run(Outcome.COMPLETED, started=5)

    await harness.service.send_pending(request_started_at=time.monotonic())

    [delivery] = harness.dao.deliveries
    assert delivery["state"] == NotificationDeliveryState.SKIPPED


def _member(user_id, role):
    return ProjectMemberProfile(user_id=user_id, email="x@example.com", role=role)


async def _recipients(harness):
    return await harness.rules.choose_recipients(
        project_id=PROJECT_ID,
        created_by_id=CREATOR,
        organization_owner_id=ORGANIZATION_OWNER,
    )


async def test_a_creator_who_can_view_is_the_only_recipient():
    owner = uuid4()
    harness = Harness(members=[_member(owner, "owner")], allowed={CREATOR, owner})

    assert await _recipients(harness) == [CREATOR]


async def test_owners_and_admins_replace_a_creator_who_cannot_view():
    owner, admin_one, admin_two, member = uuid4(), uuid4(), uuid4(), uuid4()
    harness = Harness(
        members=[
            _member(owner, "owner"),
            _member(admin_one, "admin"),
            _member(admin_two, "admin"),
            _member(member, "member"),
        ],
        allowed={owner, admin_one, admin_two, member},
    )

    assert await _recipients(harness) == [owner, admin_one, admin_two]


async def test_a_member_page_of_500_reads_the_next_page():
    first = [_member(uuid4(), "viewer") for _ in range(500)]
    admin = uuid4()
    harness = Harness(allowed={admin})
    harness.memberships.query_project_members = AsyncMock(
        side_effect=[first, [_member(admin, "admin")]]
    )

    assert await _recipients(harness) == [admin]
    calls = harness.memberships.query_project_members.await_args_list
    assert calls[1].kwargs["windowing"].next == first[-1].user_id


async def test_the_organization_owner_is_the_last_step():
    harness = Harness(allowed={ORGANIZATION_OWNER})

    assert await _recipients(harness) == [ORGANIZATION_OWNER]


async def test_no_recipient_opens_with_no_delivery():
    harness = Harness(allowed=set())

    await harness.run(FAILED, started=10)

    assert harness.states == [OPEN]
    assert harness.dao.deliveries == []


def _data(**overrides):
    return {
        "automation_id": str(AUTOMATION_ID),
        "organization_id": str(ORGANIZATION_ID),
        "automation_name": "Daily report",
        "project_name": "Growth",
        "failed_at": "2026-11-05T11:50:00+00:00",
        "last_failed_at": "2026-11-05T11:55:00+00:00",
        "reason_code": "start_failed",
        **overrides,
    }


def test_the_email_has_every_part(monkeypatch):
    monkeypatch.setattr(env.agenta, "web_url", "https://app.example.com/")

    email = render_automation_failing(PROJECT_ID, _data())

    link = (
        f"https://app.example.com/m/w/{ORGANIZATION_ID}/p/{PROJECT_ID}"
        f"/automations/{AUTOMATION_ID}"
    )
    assert email.subject == 'Automation "Daily report" in Growth is failing'
    assert email.text == (
        "The automation Daily report in project Growth "
        "has been failing since Nov 5, 2026, 11:50 UTC.\n\n"
        "Why it failed: Agenta could not start the run.\n\n"
        f"Open automation: {link}\n\n"
        "Nothing to change. If it keeps failing, contact support. "
        "You will not get another email about this until it is fixed.\n\n"
        "Agenta\nhttps://agenta.ai\n"
    )
    assert f'<a href="{link}"' in email.html
    assert "Open automation</a>" in email.html
    assert ">Nov\u00a05,\u00a02026,\u00a011:50\u00a0UTC</span>" in email.html
    assert ">Why it failed: </span>Agenta could not start the run.</p>" in email.html
    assert "cid:agenta-logo-light" in email.html
    assert "<h1" not in email.html
    assert "coworkers" not in email.html
    assert [image.cid for image in email.inline_images] == [
        "agenta-logo-light",
        "agenta-logo-dark",
    ]
    assert email.from_name == "Agenta"


@pytest.mark.parametrize(
    ("reason_code", "reason", "action"),
    [
        (
            "bad_configuration",
            "The automation could not prepare the run. Its agent or its inputs are "
            "not set correctly.",
            "Open the automation and check its agent and inputs.",
        ),
        (
            "paused_agent_deleted",
            "The automation was paused.",
            "Open the automation, check its agent and who can run it, then turn it on.",
        ),
        (
            "agent_needs_setup",
            "The agent's model needs setup, so runs are skipped.",
            "Set up the agent's model. The next run starts as usual.",
        ),
        (
            "wallet_balance_exhausted",
            "The run stopped because there are no credits left.",
            "Add credits or add your own model key.",
        ),
        (
            "access_denied",
            "The agent's run ended with an error.",
            "Open the automation to see the run and its error.",
        ),
        (
            "something_new",
            "The agent's run ended with an error.",
            "Open the automation to see the run and its error.",
        ),
    ],
)
def test_the_reason_catalog(reason_code, reason, action):
    email = render_automation_failing(PROJECT_ID, _data(reason_code=reason_code))

    assert f"\n\nWhy it failed: {reason}\n\n" in email.text
    assert f"\n\n{action} You will not get another email" in email.text
    assert html_lib.escape(reason, quote=True) in email.html


def test_markup_in_a_name_is_text_in_the_html_part():
    email = render_automation_failing(
        PROJECT_ID,
        _data(automation_name="<b>Daily</b>", project_name='"><script>x</script>'),
    )

    assert "<b>" not in email.html
    assert "<script>" not in email.html
    assert "&lt;b&gt;Daily&lt;/b&gt;" in email.html
    assert "&quot;&gt;&lt;script&gt;x&lt;/script&gt;" in email.html


@pytest.mark.parametrize(
    ("name", "normalized"),
    [
        ("Daily\r\nBcc: a@example.com", "Daily Bcc: a@example.com"),
        ("Daily‮report", "Daily report"),
        ("Daily  report", "Daily report"),
        ("Daily\t   report", "Daily report"),
        ("x" * 300, "x" * 80),
        (None, ""),
    ],
)
def test_name_normalization(name, normalized):
    assert normalize_name(name) == normalized


def test_a_subject_has_one_line_with_no_control_characters():
    email = render_automation_failing(
        PROJECT_ID, _data(automation_name="a\r\nb‮c", project_name="p\nq")
    )

    assert email.subject == 'Automation "a b c" in p q is failing'


@pytest.mark.parametrize("name", [None, "", " ‮\n"])
def test_an_automation_with_no_name(name):
    email = render_automation_failing(PROJECT_ID, _data(automation_name=name))

    assert email.subject == 'Automation "Untitled automation" in Growth is failing'


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        (
            "Internal agent error: Internal error: There's an issue with the selected "
            "model (x). It may not exist.",
            "There's an issue with the selected model (x). It may not exist.",
        ),
        (
            "pi_core: model authentication failed. Add the project's OpenAI key.",
            "model authentication failed. Add the project's OpenAI key.",
        ),
        (
            '402: {"message":"This request requires more credits."}',
            "This request requires more credits.",
        ),
        (
            'Internal agent error: 402: {"message":"More credits required."}',
            "More credits required.",
        ),
        ('402: {"message":"cut off', ""),
        ('500: {"code":1}', ""),
        ("line one\nline two\x00", "line one line two"),
        (None, ""),
    ],
)
def test_plain_error_message(message, expected):
    assert plain_error_message(message) == expected


def test_plain_error_message_is_cut():
    assert plain_error_message("a" * 400) == "a" * 297 + "..."


def test_the_email_gives_the_real_reason_and_escapes_it():
    email = render_automation_failing(
        PROJECT_ID,
        _data(reason_code="runner_error", error_message="Bad <b>model</b>."),
    )

    assert "\n\nWhy it failed: Bad <b>model</b>.\n\n" in email.text
    assert "Bad &lt;b&gt;model&lt;/b&gt;." in email.html
    assert "<b>model" not in email.html
    assert "The agent's run ended with an error." not in email.text
