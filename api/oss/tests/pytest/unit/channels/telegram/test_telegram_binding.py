"""TelegramBindingService: issue, consume, resolve a hosted bind.

Pure logic over an in-memory store, no DB. The store's atomicity is the DAO's
job; here the fake records what the service asked it to do.
"""

from datetime import timedelta
from typing import Dict, Optional, Tuple
from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.telegram_hosted.capabilities import (
    fetch_telegram_hosted_capabilities,
)
from oss.src.core.channels.identity import compose_external_user_key
from oss.src.core.channels.telegram_binding import (
    BindToken,
    BindTokenAlreadyUsed,
    BindTokenExpired,
    BindTokenInvalid,
    ChatBinding,
    ChatBoundElsewhere,
    TelegramBindingService,
    _now,
)

pytestmark = pytest.mark.asyncio

_CAPS = fetch_telegram_hosted_capabilities()


class _FakeStore:
    def __init__(self):
        self.tokens: Dict[str, BindToken] = {}
        self.bindings: Dict[Tuple[str, str], ChatBinding] = {}
        self.links = []  # (bot_id, chat_id, external_user_key) written

    async def save_token(self, token: BindToken) -> None:
        self.tokens[token.token] = token

    async def get_token(self, token: str) -> Optional[BindToken]:
        return self.tokens.get(token)

    async def get_binding(self, *, bot_id: str, chat_id: str) -> Optional[ChatBinding]:
        return self.bindings.get((bot_id, chat_id))

    async def consume_token_and_bind(
        self, *, token: BindToken, bot_id: str, chat_id: str, external_user_key: str
    ) -> ChatBinding:
        # The real DAO does this in one transaction; the fake does it in order.
        self.tokens[token.token] = BindToken(
            token=token.token,
            project_id=token.project_id,
            user_id=token.user_id,
            connection_id=token.connection_id,
            expires_at=token.expires_at,
            consumed_at=_now(),
        )
        binding = ChatBinding(
            bot_id=bot_id,
            chat_id=chat_id,
            project_id=token.project_id,
            connection_id=token.connection_id,
        )
        self.bindings[(bot_id, chat_id)] = binding
        self.links.append((bot_id, chat_id, external_user_key))
        return binding


def _service(store, *, bot_username="AgentaBot", ttl=timedelta(minutes=30)):
    return TelegramBindingService(
        store=store, bot_username=bot_username, capabilities=_CAPS, ttl=ttl
    )


async def test_issue_bind_link_returns_a_deep_link_and_stores_the_token():
    store = _FakeStore()
    svc = _service(store)
    project_id, user_id, connection_id = uuid4(), uuid4(), uuid4()

    url = await svc.issue_bind_link(
        project_id=project_id, user_id=user_id, connection_id=connection_id
    )

    assert url.startswith("https://t.me/AgentaBot?start=")
    token = url.rsplit("=", 1)[1]
    assert len(token) <= 64  # Telegram's deep-link parameter cap
    stored = await store.get_token(token)
    assert stored is not None
    assert stored.project_id == project_id
    assert stored.user_id == user_id
    assert stored.consumed_at is None


async def test_consume_binds_the_chat_and_links_the_account():
    store = _FakeStore()
    svc = _service(store)
    project_id = uuid4()
    url = await svc.issue_bind_link(
        project_id=project_id, user_id=uuid4(), connection_id=uuid4()
    )
    token = url.rsplit("=", 1)[1]

    binding = await svc.consume_bind_token(
        token=token, bot_id="100", chat_id="555", sender_id="777"
    )

    assert binding.project_id == project_id
    assert binding.chat_id == "555"
    # the account link uses the SAME key the inbox worker composes for a message
    # from this sender in this chat, so the worker finds it.
    expected_key = compose_external_user_key(_CAPS, "777", scope_id="555")
    assert store.links == [("100", "555", expected_key)]
    # the token is now consumed
    assert (await store.get_token(token)).is_consumed()


async def test_an_unknown_token_is_rejected():
    svc = _service(_FakeStore())
    with pytest.raises(BindTokenInvalid):
        await svc.consume_bind_token(
            token="nope", bot_id="100", chat_id="555", sender_id="777"
        )


async def test_an_expired_token_is_rejected():
    store = _FakeStore()
    svc = _service(store, ttl=timedelta(seconds=-1))  # already expired on issue
    url = await svc.issue_bind_link(
        project_id=uuid4(), user_id=uuid4(), connection_id=uuid4()
    )
    token = url.rsplit("=", 1)[1]
    with pytest.raises(BindTokenExpired):
        await svc.consume_bind_token(
            token=token, bot_id="100", chat_id="555", sender_id="777"
        )
    # nothing was bound
    assert store.bindings == {}


async def test_a_replayed_start_on_the_same_project_is_idempotent():
    store = _FakeStore()
    svc = _service(store)
    project_id = uuid4()
    url = await svc.issue_bind_link(
        project_id=project_id, user_id=uuid4(), connection_id=uuid4()
    )
    token = url.rsplit("=", 1)[1]

    first = await svc.consume_bind_token(
        token=token, bot_id="100", chat_id="555", sender_id="777"
    )
    # a second /start with the same (already consumed) token, same chat:
    second = await svc.consume_bind_token(
        token=token, bot_id="100", chat_id="555", sender_id="777"
    )
    assert second == first
    # the account link is not written twice
    expected_key = compose_external_user_key(_CAPS, "777", scope_id="555")
    assert store.links == [("100", "555", expected_key)]


async def test_a_chat_bound_to_another_project_is_refused():
    store = _FakeStore()
    svc = _service(store)
    # chat 555 is already bound to project A
    other = uuid4()
    store.bindings[("100", "555")] = ChatBinding(
        bot_id="100", chat_id="555", project_id=other, connection_id=uuid4()
    )
    # a token for project B tries to claim the same chat
    url = await svc.issue_bind_link(
        project_id=uuid4(), user_id=uuid4(), connection_id=uuid4()
    )
    token = url.rsplit("=", 1)[1]
    with pytest.raises(ChatBoundElsewhere):
        await svc.consume_bind_token(
            token=token, bot_id="100", chat_id="555", sender_id="777"
        )


async def test_a_consumed_token_on_a_new_chat_is_rejected():
    # Reusing a spent token to bind a DIFFERENT chat must fail.
    store = _FakeStore()
    svc = _service(store)
    url = await svc.issue_bind_link(
        project_id=uuid4(), user_id=uuid4(), connection_id=uuid4()
    )
    token = url.rsplit("=", 1)[1]
    await svc.consume_bind_token(
        token=token, bot_id="100", chat_id="555", sender_id="777"
    )
    with pytest.raises(BindTokenAlreadyUsed):
        await svc.consume_bind_token(
            token=token, bot_id="100", chat_id="999", sender_id="777"
        )


async def test_resolve_returns_the_binding_or_none():
    store = _FakeStore()
    svc = _service(store)
    assert await svc.resolve_bound_connection(bot_id="100", chat_id="555") is None
    url = await svc.issue_bind_link(
        project_id=uuid4(), user_id=uuid4(), connection_id=uuid4()
    )
    token = url.rsplit("=", 1)[1]
    await svc.consume_bind_token(
        token=token, bot_id="100", chat_id="555", sender_id="777"
    )
    resolved = await svc.resolve_bound_connection(bot_id="100", chat_id="555")
    assert resolved is not None and resolved.chat_id == "555"
