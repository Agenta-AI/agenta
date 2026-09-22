from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import httpx
import pytest

from oss.src.core.channels.adapters.telegram.adapter import TelegramAdapter
from oss.src.core.channels.adapters.telegram.capabilities import (
    fetch_telegram_capabilities,
)
from oss.src.core.channels.adapters.telegram.mapping import render_content
from oss.src.core.channels.dtos import ChannelPendingChoice
from oss.src.core.channels.render.render import render_turn_result
from oss.src.core.channels.service import ChannelsService
from oss.src.tasks.asyncio.channels.inbox import InboxDispatcher
from oss.src.apis.fastapi.channels.ingress import ChannelsIngressRouter
from oss.src.core.channels.telegram_binding import ChatBoundElsewhere


def card(arguments):
    return render_turn_result(
        capabilities=fetch_telegram_capabilities(),
        folded={
            "stop_reason": "paused",
            "pending_interaction": {
                "id": "approval",
                "tool": "mcp__agenta-tools__discover_tools",
                "payload": {"toolCall": {"rawInput": arguments}},
            },
        },
    )[0]


def test_runtime_raw_input_and_readable_name_reach_telegram():
    item = card({"use_cases": ["find a calculator tool for a synthetic QA check"]})
    text, keyboard = render_content(
        [part.model_dump(exclude_none=True) for part in item.parts]
    )
    assert "Approval needed: Discover tools" in text
    assert "mcp__" not in text
    assert "find a calculator tool for a synthetic QA check" in text
    assert "once" in text and "Deny prevents it" in text
    assert keyboard["inline_keyboard"][0][0]["callback_data"] == "approve"


def test_empty_args_are_not_mistaken_for_missing_args():
    assert card({}).parts[0].arguments == {}


def test_secrets_are_redacted_before_adapter_rendering():
    item = card(
        {"nested": [{"api_key": "private-value", "bot_token": "private-token"}]}
    )
    assert "private-value" not in item.model_dump_json()
    assert "private-token" not in item.model_dump_json()


def test_oversized_escaped_arguments_fit_one_telegram_card():
    item = card({"value": "<&" * 4000})
    text, _ = render_content(
        [part.model_dump(exclude_none=True) for part in item.parts]
    )
    assert len(text) < 4096
    assert "Truncated" in text


@pytest.mark.asyncio
async def test_dismiss_controls_edits_only_keyboard():
    adapter = TelegramAdapter()
    adapter._call = AsyncMock(return_value={"ok": True, "result": True})
    await adapter.dismiss_choices(
        connection=Mock(), external_locator={"chat_id": 1, "message_id": 2}
    )
    assert adapter._call.await_args.args[1:] == (
        "editMessageReplyMarkup",
        {"chat_id": 1, "message_id": 2, "reply_markup": {"inline_keyboard": []}},
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("fail_admission", [False, True])
async def test_controls_are_removed_only_after_admission(fail_admission):
    service = SimpleNamespace(
        set_pending_choice=AsyncMock(), dismiss_approval_choices=AsyncMock()
    )
    respond = AsyncMock(
        side_effect=RuntimeError("not admitted") if fail_admission else None
    )
    dispatcher = InboxDispatcher(
        channels_service=service, respond_interaction_fn=respond
    )
    dispatcher._invoking_user_id = AsyncMock(return_value=uuid4())
    resolution = SimpleNamespace(
        answered_interaction_id=str(uuid4()),
        resolved_token="deny",
        resolved_choice="Deny",
        thread=SimpleNamespace(id=uuid4()),
        agent=SimpleNamespace(created_by_id=uuid4()),
    )
    args = dict(
        project_id=uuid4(),
        connection_id=uuid4(),
        event=SimpleNamespace(id=uuid4()),
        resolution=resolution,
    )
    if fail_admission:
        with pytest.raises(RuntimeError):
            await dispatcher._answer_interaction(**args)
        service.dismiss_approval_choices.assert_not_awaited()
        service.set_pending_choice.assert_not_awaited()
    else:
        await dispatcher._answer_interaction(**args)
        service.dismiss_approval_choices.assert_awaited_once()
        assert (
            service.set_pending_choice.await_args.kwargs["expected_interaction_id"]
            == resolution.answered_interaction_id
        )


@pytest.mark.asyncio
async def test_ui_failure_does_not_retry_an_admitted_decision():
    service = SimpleNamespace(
        set_pending_choice=AsyncMock(),
        dismiss_approval_choices=AsyncMock(side_effect=httpx.ReadTimeout("timeout")),
    )
    respond = AsyncMock()
    dispatcher = InboxDispatcher(
        channels_service=service, respond_interaction_fn=respond
    )
    dispatcher._invoking_user_id = AsyncMock(return_value=uuid4())
    resolution = SimpleNamespace(
        answered_interaction_id=str(uuid4()),
        resolved_token="approve",
        resolved_choice="Approve",
        thread=SimpleNamespace(id=uuid4()),
        agent=SimpleNamespace(created_by_id=uuid4()),
    )
    await dispatcher._answer_interaction(
        project_id=uuid4(),
        connection_id=uuid4(),
        event=SimpleNamespace(id=uuid4()),
        resolution=resolution,
    )
    respond.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("wrong_card", [False, True])
async def test_cleanup_targets_only_the_answered_cards_stored_receipt(wrong_card):
    interaction = str(uuid4())
    event_id, thread_id, connection_id = uuid4(), uuid4(), uuid4()
    pending = ChannelPendingChoice(
        choices=[],
        posted_at="2026-09-22T00:00:00Z",
        interaction_id=interaction,
        outbox_event_id=event_id,
    )
    event = SimpleNamespace(
        thread_id=thread_id,
        connection_id=connection_id,
        data=SimpleNamespace(
            external_locator={"chat_id": 1, "message_id": 2},
            processed={
                "content": [
                    {
                        "type": "button",
                        "value": f"{'new-card' if wrong_card else interaction}:approve",
                    }
                ]
            },
        ),
    )
    adapter = SimpleNamespace(dismiss_choices=AsyncMock())
    service = ChannelsService(channels_dao=Mock(), adapter_registry=Mock())
    service.channels_dao.fetch_outbox_event = AsyncMock(return_value=event)
    service.fetch_connection = AsyncMock(
        return_value=SimpleNamespace(channel="telegram")
    )
    service.adapter_registry.get.return_value = adapter
    await service.dismiss_approval_choices(
        project_id=uuid4(),
        connection_id=connection_id,
        thread=SimpleNamespace(
            id=thread_id, data=SimpleNamespace(pending_choice=pending)
        ),
        interaction_id=interaction,
    )
    assert adapter.dismiss_choices.await_count == (0 if wrong_card else 1)


@pytest.mark.asyncio
async def test_bound_elsewhere_message_is_not_an_expired_link():
    router = object.__new__(ChannelsIngressRouter)
    router.telegram_binding_service = SimpleNamespace(
        consume_bind_token=AsyncMock(side_effect=ChatBoundElsewhere())
    )
    router._hosted_say = AsyncMock()
    await router._complete_hosted_bind(
        adapter=Mock(), token="qa", bot_id="1", chat_id="2", sender_id="2"
    )
    text = router._hosted_say.await_args.args[2]
    assert "another Agenta project" in text
    assert "Disconnect" in text
    assert "not valid" not in text
