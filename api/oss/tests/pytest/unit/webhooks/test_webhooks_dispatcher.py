from types import SimpleNamespace
from uuid import uuid4

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from oss.src.core.events.types import EventType
from oss.src.core.webhooks.types import WebhookEventType
from oss.src.tasks.asyncio.webhooks.dispatcher import WebhooksDispatcher


class FakeEvent:
    def __init__(self, *, event_type: EventType):
        self.event_type = event_type
        self.event_id = uuid4()
        self.attributes = None

    def model_dump(self, **_kwargs):
        return {
            "event_id": str(self.event_id),
            "event_type": self.event_type.value,
        }


class FakeSubscription:
    def __init__(
        self,
        *,
        subscription_id: str,
        event_types: list[WebhookEventType] | None,
        secret: str,
    ):
        self.id = subscription_id
        self.name = f"sub-{subscription_id}"
        self.secret = secret
        self.data = SimpleNamespace(
            event_types=event_types,
            url="https://example.com/webhook",
            headers=None,
            payload_fields=None,
            auth_mode=None,
        )

    def model_dump(self, **_kwargs):
        return {
            "id": self.id,
            "name": self.name,
            "data": {
                "url": self.data.url,
                "event_types": [
                    event_type.value for event_type in self.data.event_types
                ]
                if self.data.event_types is not None
                else None,
            },
        }


@pytest.mark.anyio
async def test_dispatch_real_event_without_flags_still_enqueues_matching_subscription(
    anyio_backend,
):
    assert anyio_backend == "asyncio"
    matching = FakeSubscription(
        subscription_id=str(uuid4()),
        event_types=[WebhookEventType.ENVIRONMENTS_REVISIONS_COMMITTED],
        secret="secret-1",
    )
    non_matching = FakeSubscription(
        subscription_id=str(uuid4()),
        event_types=[WebhookEventType.WEBHOOKS_SUBSCRIPTIONS_TESTED],
        secret="secret-2",
    )

    deliver_task = MagicMock()
    deliver_task.kiq = AsyncMock()

    dispatcher = WebhooksDispatcher(
        subscriptions_dao=MagicMock(),
        vault_service=MagicMock(),
        deliver_task=deliver_task,
    )
    dispatcher._get_subscriptions = AsyncMock(return_value=[matching, non_matching])

    project_id = uuid4()
    event = FakeEvent(event_type=EventType.ENVIRONMENTS_REVISIONS_COMMITTED)
    message = SimpleNamespace(event=event)

    with patch(
        "oss.src.tasks.asyncio.webhooks.dispatcher.encrypt",
        side_effect=lambda secret: f"enc:{secret}",
    ):
        await dispatcher.dispatch(
            batches=[
                {
                    "project_id": project_id,
                    "events": [message],
                }
            ]
        )

    deliver_task.kiq.assert_awaited_once()
    kwargs = deliver_task.kiq.await_args.kwargs
    assert kwargs["project_id"] == str(project_id)
    assert kwargs["subscription_id"] == matching.id
    assert kwargs["event_id"] == str(event.event_id)
    assert kwargs["event_type"] == EventType.ENVIRONMENTS_REVISIONS_COMMITTED.value
    assert kwargs["encrypted_secret"] == "enc:secret-1"


@pytest.mark.anyio
async def test_dispatch_deterministic_delivery_id_stable_across_passes(anyio_backend):
    assert anyio_backend == "asyncio"
    subscription_id = str(uuid4())
    sub = FakeSubscription(
        subscription_id=subscription_id,
        event_types=None,
        secret="secret-1",
    )

    deliver_task = MagicMock()
    deliver_task.kiq = AsyncMock()

    dispatcher = WebhooksDispatcher(
        subscriptions_dao=MagicMock(),
        vault_service=MagicMock(),
        deliver_task=deliver_task,
    )
    dispatcher._get_subscriptions = AsyncMock(return_value=[sub])

    project_id = uuid4()
    event = FakeEvent(event_type=EventType.ENVIRONMENTS_REVISIONS_COMMITTED)
    message = SimpleNamespace(event=event)

    with patch(
        "oss.src.tasks.asyncio.webhooks.dispatcher.encrypt",
        side_effect=lambda secret: f"enc:{secret}",
    ):
        # Two passes over the same (event_id, subscription_id) — as a Redis-Streams
        # redelivery would produce — must derive the same delivery_id both times.
        await dispatcher.dispatch(
            batches=[{"project_id": project_id, "events": [message]}]
        )
        await dispatcher.dispatch(
            batches=[{"project_id": project_id, "events": [message]}]
        )

    first_delivery_id = deliver_task.kiq.await_args_list[0].kwargs["delivery_id"]
    second_delivery_id = deliver_task.kiq.await_args_list[1].kwargs["delivery_id"]
    assert first_delivery_id == second_delivery_id


@pytest.mark.anyio
async def test_dispatch_one_failing_delivery_does_not_raise_and_others_still_enqueue(
    anyio_backend,
):
    assert anyio_backend == "asyncio"
    failing = FakeSubscription(
        subscription_id=str(uuid4()),
        event_types=None,
        secret="secret-fail",
    )
    succeeding = FakeSubscription(
        subscription_id=str(uuid4()),
        event_types=None,
        secret="secret-ok",
    )

    deliver_task = MagicMock()

    async def kiq(**kwargs):
        if kwargs["subscription_id"] == failing.id:
            raise RuntimeError("enqueue boom")
        return None

    deliver_task.kiq = AsyncMock(side_effect=kiq)

    dispatcher = WebhooksDispatcher(
        subscriptions_dao=MagicMock(),
        vault_service=MagicMock(),
        deliver_task=deliver_task,
    )
    dispatcher._get_subscriptions = AsyncMock(return_value=[failing, succeeding])

    project_id = uuid4()
    event = FakeEvent(event_type=EventType.ENVIRONMENTS_REVISIONS_COMMITTED)
    message = SimpleNamespace(event=event)

    with patch(
        "oss.src.tasks.asyncio.webhooks.dispatcher.encrypt",
        side_effect=lambda secret: f"enc:{secret}",
    ):
        # Must not raise: one bad delivery must never fail the whole batch.
        await dispatcher.dispatch(
            batches=[{"project_id": project_id, "events": [message]}]
        )

    enqueued_subscription_ids = {
        call.kwargs["subscription_id"] for call in deliver_task.kiq.await_args_list
    }
    assert succeeding.id in enqueued_subscription_ids
    assert failing.id in enqueued_subscription_ids  # attempted, but its enqueue failed


@pytest.fixture
def anyio_backend():
    return "asyncio"
