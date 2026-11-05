"""The send step of `NotificationsService`."""

import time
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.core.notifications import service as service_module
from oss.src.core.notifications.dtos import (
    NotificationDeliveryState as State,
    NotificationKind,
    NotificationState,
    RenderedEmail,
)
from oss.src.core.notifications.service import (
    MAX_SEND_ATTEMPTS,
    NotificationsService,
)
from oss.src.utils.env import env
from oss.tests.pytest.unit.triggers._failure_fakes import FakeNotificationsDAO

EMAIL = "person@example.com"
RENDERED = RenderedEmail(subject="Subject", html="<p>Body</p>", text="Body")


@pytest.fixture
def sender(monkeypatch):
    send = AsyncMock()
    monkeypatch.setattr(service_module, "send_rendered_email", send)
    monkeypatch.setattr(env.agenta.notifications, "email_enabled", True)
    monkeypatch.setattr(env.smtp, "host", "smtp.example.com")
    monkeypatch.setattr(env.smtp, "port", 587)
    monkeypatch.setattr(env.smtp, "from_email", "from@example.com")
    return send


def _service(*, emails=None, template=None):
    dao = FakeNotificationsDAO()
    memberships = MagicMock()

    async def fetch_member_emails(*, user_ids):
        if emails is None:
            return {user_id: EMAIL for user_id in user_ids}
        return emails

    memberships.fetch_member_emails = fetch_member_emails
    service = NotificationsService(
        notifications_dao=dao,
        memberships_service=memberships,
        template=template or MagicMock(return_value=RENDERED),
    )
    return service, dao


async def _open(dao, *, recipients=1, key=None):
    await dao.open(
        project_id=uuid4(),
        kind=NotificationKind.AUTOMATION_FAILING,
        dedup_key=key or f"automation:{uuid4()}",
        data={"last_failed_at": "2026-11-05T11:50:00+00:00"},
        user_ids=[uuid4() for _ in range(recipients)],
    )


async def _send(service):
    await service.send_pending(request_started_at=time.monotonic())


def _states(dao):
    return [row["state"] for row in dao.deliveries]


async def test_a_delivery_is_sent_with_its_rendered_parts(sender):
    service, dao = _service()
    await _open(dao)

    await _send(service)

    sender.assert_awaited_once_with(EMAIL, "Subject", "<p>Body</p>", "Body")
    assert _states(dao) == [State.SENT]


async def test_a_request_sends_at_most_100(sender):
    service, dao = _service()
    await _open(dao, recipients=101)

    await _send(service)

    assert sender.await_count == 100
    assert _states(dao).count(State.CREATED) == 1


async def test_the_switch_off_skips_and_keeps_the_notification(sender, monkeypatch):
    monkeypatch.setattr(env.agenta.notifications, "email_enabled", False)
    service, dao = _service()
    await _open(dao)

    await _send(service)

    sender.assert_not_awaited()
    assert _states(dao) == [State.SKIPPED]
    assert dao.notifications[0]["state"] == NotificationState.OPEN


async def test_no_provider_skips(sender, monkeypatch):
    monkeypatch.setattr(env.smtp, "host", None)
    monkeypatch.setattr(env.sendgrid, "api_key", None)
    service, dao = _service()
    await _open(dao)

    await _send(service)

    sender.assert_not_awaited()
    assert _states(dao) == [State.SKIPPED]


async def test_a_resolved_notification_skips_without_rendering(sender):
    template = MagicMock(return_value=RENDERED)
    service, dao = _service(template=template)
    await _open(dao)
    dao.notifications[0]["state"] = NotificationState.RESOLVED

    await _send(service)

    template.assert_not_called()
    assert _states(dao) == [State.SKIPPED]


async def test_a_recipient_with_no_email_skips(sender):
    service, dao = _service(emails={})
    await _open(dao)

    await _send(service)

    sender.assert_not_awaited()
    assert _states(dao) == [State.SKIPPED]


async def test_a_provider_error_counts_one_attempt_and_stops_the_loop(sender):
    sender.side_effect = TimeoutError()
    service, dao = _service()
    await _open(dao, recipients=3)

    await _send(service)

    assert sender.await_count == 1
    assert [row["attempt_count"] for row in dao.deliveries] == [1, 0, 0]
    assert _states(dao) == [State.CREATED] * 3


async def test_the_provider_comes_back_and_the_delivery_is_sent(sender):
    sender.side_effect = [ConnectionError(), ConnectionError(), None]
    service, dao = _service()
    await _open(dao)

    for _ in range(3):
        await _send(service)

    assert _states(dao) == [State.SENT]


async def test_five_failures_end_as_failed_and_no_more_sends(sender):
    sender.side_effect = ConnectionError()
    service, dao = _service()
    await _open(dao)

    for _ in range(MAX_SEND_ATTEMPTS + 2):
        await _send(service)

    assert sender.await_count == MAX_SEND_ATTEMPTS
    assert _states(dao) == [State.FAILED]


async def test_an_error_before_the_send_counts_and_the_loop_goes_on(sender):
    template = MagicMock(side_effect=[KeyError("failed_at"), RENDERED])
    service, dao = _service(template=template)
    await _open(dao, recipients=2)

    await _send(service)

    assert [row["attempt_count"] for row in dao.deliveries] == [1, 0]
    assert _states(dao) == [State.CREATED, State.SENT]


async def test_no_new_send_after_five_minutes(sender):
    service, dao = _service()
    await _open(dao)

    await service.send_pending(request_started_at=time.monotonic() - 300)

    sender.assert_not_awaited()
    assert _states(dao) == [State.CREATED]


async def test_a_slow_provider_stops_at_the_window(sender, monkeypatch):
    clock = {"now": 0.0}
    monkeypatch.setattr(service_module.time, "monotonic", lambda: clock["now"])

    async def slow(*_):
        clock["now"] += 60

    sender.side_effect = slow
    service, dao = _service()
    await _open(dao, recipients=8)

    await service.send_pending(request_started_at=0.0)

    assert sender.await_count == 5
    assert _states(dao).count(State.CREATED) == 3


async def test_a_failure_log_holds_ids_and_the_exception_type_only(sender, monkeypatch):
    warning = MagicMock()
    monkeypatch.setattr(service_module.log, "warning", warning)
    sender.side_effect = RuntimeError(f"550 rejected {EMAIL}")
    service, dao = _service()
    await _open(dao)

    await _send(service)

    logged = repr(warning.call_args)
    assert "RuntimeError" in logged
    assert EMAIL not in logged
    assert "rejected" not in logged
