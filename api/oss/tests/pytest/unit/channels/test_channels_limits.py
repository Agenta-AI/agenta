"""Channel limits: whom an agent answers (its people list on the binding),
where it answers (its rules), and the one private note a refused person gets.
No DB: a fake DAO stands in for persistence."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelAgentAudience,
    ChannelAgentCreate,
    ChannelAgentData,
    ChannelAgentFlags,
    ChannelAgentDataEdit,
    ChannelAgentEdit,
    ChannelConnection,
    ChannelConnectionFlags,
    ChannelDeliveryState,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelGrant,
    ChannelGrantCreate,
    ChannelGrantData,
    ChannelGrantEffect,
    ChannelInboxEvent,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelOutboxEvent,
    ChannelOutboxEventData,
    ChannelRefusal,
    ChannelRefusalReason,
    ChannelSpace,
    ChannelSpaceData,
    ChannelSpaceKind,
    ChannelThread,
)
from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.render.render import (
    REFUSED_CHANNEL_TEXT,
    REFUSED_DIRECT_MESSAGE_TEXT,
    REFUSED_SENDER_TEXT,
)
from oss.src.core.channels.service import ChannelsService, _layer_agent_edit
from oss.src.core.sharing.types import SharedItemNotFound
from oss.src.tasks.asyncio.channels.inbox import InboxDispatcher

from .contract.fakes import WellBehavedFakeAdapter

_LOCATOR = {"team": "T1", "channel": "C1", "thread_ts": "1000.1"}


def _connection(*, data=None, channel="agenta"):
    return ChannelConnection(
        id=uuid4(),
        slug="conn-1",
        channel=channel,
        external_key=uuid4(),
        data=data or {},
        flags=ChannelConnectionFlags(is_verified=True),
    )


def _agent(*, senders=None):
    return ChannelAgent(
        id=uuid4(),
        slug="triage",
        connection_id=uuid4(),
        created_by_id=uuid4(),
        data=ChannelAgentData(
            references={"workflow_revision": {"id": str(uuid4())}},
            audience=ChannelAgentAudience(senders=senders or []),
        ),
    )


def _event(*, text="~triage hi", sender="U1", space_kind=ChannelSpaceKind.TOPIC):
    return ChannelInboxEvent(
        id=uuid4(),
        connection_id=uuid4(),
        external_id="evt-1",
        kind=ChannelEventKind.MESSAGE,
        origin=ChannelEventOrigin.PUSHED,
        data=ChannelInboxEventData(
            external_locator=_LOCATOR,
            processed=ChannelInboxEventProcessed(
                content=[{"type": "text", "text": text}],
                sender={"id": sender},
            ),
            space_kind=space_kind,
        ),
    )


async def _get_or_create_space(*, project_id, user_id, space):
    return ChannelSpace(
        id=uuid4(),
        connection_id=space.connection_id,
        kind=space.kind,
        external_key=space.external_key,
        data=space.data,
    )


def _dao(*, agent, connection=None, grants=None, grant_count=0):
    dao = MagicMock()
    dao.fetch_connection = AsyncMock(return_value=connection or _connection())
    dao.fetch_space_by_key = AsyncMock(return_value=None)
    dao.get_or_create_space = AsyncMock(side_effect=_get_or_create_space)
    dao.fetch_thread_awaiting_choice = AsyncMock(return_value=None)
    dao.fetch_active_thread = AsyncMock(return_value=None)
    dao.fetch_agent_by_slug = AsyncMock(return_value=agent)
    dao.fetch_default_grant = AsyncMock(return_value=None)
    dao.fetch_default_agent = AsyncMock(return_value=agent)
    dao.fetch_agent = AsyncMock(return_value=agent)
    dao.attach_event_to_space = AsyncMock(return_value=None)
    dao.query_matching_grants = AsyncMock(return_value=grants or [])
    dao.count_grants = AsyncMock(return_value=grant_count)
    dao.fetch_current_thread = AsyncMock(return_value=None)
    dao.create_thread = AsyncMock(
        side_effect=lambda **kw: ChannelThread(
            id=uuid4(),
            space_id=kw["thread"].space_id,
            agent_id=kw["thread"].agent_id,
            external_key=kw["thread"].external_key,
            session_id=kw["thread"].session_id,
            data=kw["thread"].data,
        )
    )
    return dao


def _service(dao, adapter=None):
    return ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(
            adapters={"agenta": adapter or WellBehavedFakeAdapter()}
        ),
    )


def _grant(agent, *, effect, kind=None, space_id=None):
    return ChannelGrant(
        id=uuid4(),
        agent_id=agent.id,
        effect=effect,
        kind=kind,
        space_id=space_id,
        data=ChannelGrantData(),
    )


# --- the people list ------------------------------------------------------------ #


def test_an_empty_people_list_answers_everyone_and_ids_compare_as_strings():
    assert ChannelAgentAudience().admits("U1") is True
    assert ChannelAgentAudience().admits(None) is True
    assert ChannelAgentAudience(senders=["U1"]).admits("U1") is True
    assert ChannelAgentAudience(senders=["U1"]).admits("U2") is False
    assert ChannelAgentAudience(senders=["U1"]).admits(None) is False
    # Telegram ids stored as numbers by older rows still match
    assert ChannelAgentAudience(senders=[8883745180]).admits("8883745180") is True
    # nulls and blanks are dropped, repeats kept once
    assert ChannelAgentAudience(senders=[None, "", "U1", "U1"]).senders == ["U1"]
    assert ChannelAgentAudience(senders=[None]).senders == []


def test_agent_data_without_audience_reads_as_everyone():
    data = ChannelAgentData.model_validate(
        {"references": {"workflow_revision": {"id": str(uuid4())}}}
    )
    assert data.audience.senders == []


async def test_a_person_not_on_the_list_who_mentions_the_agent_is_refused_with_a_note():
    agent = _agent(senders=["ANA"])
    dao = _dao(agent=agent)

    routing = await _service(dao).resolve_or_refuse(
        project_id=uuid4(), connection_id=uuid4(), event=_event(sender="BEN")
    )

    assert routing.resolution is None
    assert routing.refusal is not None
    assert routing.refusal.reason is ChannelRefusalReason.SENDER_NOT_LISTED
    assert routing.refusal.sender_id == "BEN"
    # not attached to its space: it never reaches the agent as context
    dao.attach_event_to_space.assert_not_awaited()
    dao.create_thread.assert_not_awaited()


async def test_a_person_not_on_the_list_who_does_not_address_the_agent_gets_nothing():
    agent = _agent(senders=["ANA"])
    dao = _dao(agent=agent)

    routing = await _service(dao).resolve_or_refuse(
        project_id=uuid4(),
        connection_id=uuid4(),
        event=_event(text="just chatting", sender="BEN"),
    )

    assert routing.resolution is None
    assert routing.refusal is None
    dao.attach_event_to_space.assert_not_awaited()


async def test_a_person_on_the_list_is_answered():
    agent = _agent(senders=["ANA"])
    dao = _dao(agent=agent)

    routing = await _service(dao).resolve_or_refuse(
        project_id=uuid4(), connection_id=uuid4(), event=_event(sender="ANA")
    )

    assert routing.refusal is None
    assert routing.resolution is not None
    dao.attach_event_to_space.assert_awaited_once()


async def test_the_installation_list_no_longer_limits_another_agent():
    """Two agents on one hosted Slack installation: a list kept on the
    installation by older code does not limit the agent without a list."""

    agent_b = _agent(senders=[])
    dao = _dao(
        agent=agent_b,
        connection=_connection(data={"allowed_senders": ["ANA"]}),
    )

    routing = await _service(dao).resolve_or_refuse(
        project_id=uuid4(), connection_id=uuid4(), event=_event(sender="BEN")
    )

    assert routing.resolution is not None


async def test_removing_a_person_refuses_their_next_message():
    agent = _agent(senders=["ANA"])
    dao = _dao(agent=agent)
    service = _service(dao)

    first = await service.resolve_or_refuse(
        project_id=uuid4(), connection_id=uuid4(), event=_event(sender="ANA")
    )
    assert first.resolution is not None

    agent.data.audience = ChannelAgentAudience(senders=["CAROL"])
    second = await service.resolve_or_refuse(
        project_id=uuid4(), connection_id=uuid4(), event=_event(sender="ANA")
    )
    assert second.resolution is None
    assert second.refusal is not None


# --- where it answers ----------------------------------------------------------- #


async def test_a_mention_in_an_unchecked_channel_is_refused_with_a_note():
    """'Only these channels' is allow rules with no deny: a channel no rule
    names is off while any rule exists."""

    agent = _agent()
    dao = _dao(agent=agent, grants=[], grant_count=2)

    routing = await _service(dao).resolve_or_refuse(
        project_id=uuid4(), connection_id=uuid4(), event=_event()
    )

    assert routing.resolution is None
    assert routing.refusal.reason is ChannelRefusalReason.SPACE_OFF
    assert routing.refusal.space.kind is ChannelSpaceKind.TOPIC


async def test_a_mention_in_a_checked_channel_is_answered():
    agent = _agent()
    dao = _dao(agent=agent, grant_count=2)
    dao.query_matching_grants = AsyncMock(
        side_effect=lambda **kw: [
            _grant(agent, effect=ChannelGrantEffect.ALLOW, space_id=kw["space_id"])
        ]
    )

    routing = await _service(dao).resolve_or_refuse(
        project_id=uuid4(), connection_id=uuid4(), event=_event()
    )

    assert routing.resolution is not None


async def test_a_dm_while_dms_are_off_is_refused_with_a_note():
    agent = _agent()
    dao = _dao(
        agent=agent,
        grants=[
            _grant(agent, effect=ChannelGrantEffect.DENY, kind=ChannelSpaceKind.PRIVATE)
        ],
    )

    routing = await _service(dao).resolve_or_refuse(
        project_id=uuid4(),
        connection_id=uuid4(),
        event=_event(text="hello", space_kind=ChannelSpaceKind.PRIVATE),
    )

    assert routing.refusal.reason is ChannelRefusalReason.SPACE_OFF
    assert routing.refusal.space.kind is ChannelSpaceKind.PRIVATE


async def test_an_unaddressed_message_in_an_off_channel_is_stored_silently():
    agent = _agent()
    dao = _dao(agent=agent, grant_count=1)

    routing = await _service(dao).resolve_or_refuse(
        project_id=uuid4(),
        connection_id=uuid4(),
        event=_event(text="no mention here"),
    )

    assert routing.resolution is None
    assert routing.refusal is None
    # an allowed person's message stays context, as before
    dao.attach_event_to_space.assert_awaited_once()


async def test_resolve_keeps_returning_none_on_a_refusal():
    agent = _agent(senders=["ANA"])
    dao = _dao(agent=agent)

    result = await _service(dao).resolve(
        project_id=uuid4(), connection_id=uuid4(), event=_event(sender="BEN")
    )

    assert result is None


# --- the edit ------------------------------------------------------------------- #


def test_an_edit_that_sends_the_audience_replaces_it_and_one_that_omits_it_keeps_it():
    existing = _agent(senders=["ANA"])

    kept = _layer_agent_edit(
        existing=existing,
        edit=ChannelAgentEdit(
            id=existing.id,
            data=ChannelAgentDataEdit(tools={"can_post_outside_conversation": False}),
        ),
    )
    assert kept.data.audience.senders == ["ANA"]

    replaced = _layer_agent_edit(
        existing=existing,
        edit=ChannelAgentEdit(
            id=existing.id,
            data=ChannelAgentDataEdit(
                audience={"senders": ["BEN"], "labels": {"BEN": {"name": "Ben"}}}
            ),
        ),
    )
    assert replaced.data.audience.senders == ["BEN"]
    assert replaced.data.audience.labels["BEN"].name == "Ben"


def test_an_edit_may_not_send_a_null_audience():
    with pytest.raises(ValueError):
        ChannelAgentDataEdit(audience=None)


# --- who may change the limits -------------------------------------------------- #


def _sync_guarded(refuse, result):
    """A DAO write that, like the real one, refuses inside the write when it is
    given an agent to guard and the caller is not its owner."""

    async def write(**kwargs):
        guarded = (
            kwargs.get("guard_artifact_id")
            or kwargs.get("guard_artifact_ids")
            or kwargs.get("guard_artifact_ids")
        )
        if refuse and guarded:
            raise SharedItemNotFound()
        return result(kwargs)

    return write


def _guarded_service(dao, *, refuse):
    workflows = MagicMock()
    workflows.resolve_agent_artifact_id = AsyncMock(return_value=uuid4())
    dao.edit_agent = AsyncMock(
        side_effect=_sync_guarded(refuse, lambda kw: kw["agent"])
    )
    dao.create_grant = AsyncMock(
        side_effect=_sync_guarded(refuse, lambda kw: MagicMock())
    )
    dao.create_agent = AsyncMock(
        side_effect=_sync_guarded(
            refuse,
            lambda kw: ChannelAgent(
                id=uuid4(),
                slug=kw["agent"].slug,
                connection_id=kw["agent"].connection_id,
                data=kw["agent"].data,
                flags=kw["agent"].flags,
            ),
        )
    )

    dao.edit_grant = AsyncMock(
        side_effect=_sync_guarded(refuse, lambda kw: MagicMock())
    )
    service = ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(adapters={}),
        workflows_service=workflows,
    )
    service._invalidate_bindings = AsyncMock()
    return service


async def test_someone_else_cannot_change_a_private_agents_people_list():
    agent = _agent(senders=["ANA"])
    agent.flags.is_active = False  # the activation guard would not run
    dao = _dao(agent=agent)
    service = _guarded_service(dao, refuse=True)

    with pytest.raises(SharedItemNotFound):
        await service.edit_agent(
            project_id=uuid4(),
            user_id=uuid4(),
            guard_user_id=uuid4(),
            agent=ChannelAgentEdit(
                id=agent.id, data=ChannelAgentDataEdit(audience={"senders": ["BEN"]})
            ),
        )


async def test_an_edit_that_leaves_the_people_list_alone_is_not_guarded():
    agent = _agent(senders=["ANA"])
    agent.flags.is_active = False
    dao = _dao(agent=agent)
    service = _guarded_service(dao, refuse=True)

    await service.edit_agent(
        project_id=uuid4(),
        user_id=uuid4(),
        guard_user_id=uuid4(),
        agent=ChannelAgentEdit(id=agent.id, name="renamed"),
    )
    assert dao.edit_agent.await_args.kwargs["guard_artifact_id"] is None
    assert not dao.edit_agent.await_args.kwargs.get("guard_artifact_ids")


async def test_someone_else_cannot_add_a_rule_to_a_private_agent():
    agent = _agent()
    dao = _dao(agent=agent)
    service = _guarded_service(dao, refuse=True)

    with pytest.raises(SharedItemNotFound):
        await service.create_grant(
            project_id=uuid4(),
            user_id=uuid4(),
            guard_user_id=uuid4(),
            grant=ChannelGrantCreate(
                agent_id=agent.id,
                effect=ChannelGrantEffect.ALLOW,
                kind=ChannelSpaceKind.PRIVATE,
                data=ChannelGrantData(),
            ),
        )


async def test_the_owner_adds_a_rule():
    agent = _agent()
    dao = _dao(agent=agent)
    service = _guarded_service(dao, refuse=False)

    await service.create_grant(
        project_id=uuid4(),
        user_id=uuid4(),
        guard_user_id=uuid4(),
        grant=ChannelGrantCreate(
            agent_id=agent.id,
            effect=ChannelGrantEffect.ALLOW,
            kind=ChannelSpaceKind.PRIVATE,
            data=ChannelGrantData(),
        ),
    )
    dao.create_grant.assert_awaited_once()
    assert dao.create_grant.await_args.kwargs["guard_artifact_ids"]


# --- the note ------------------------------------------------------------------- #


class _NoteAdapter:
    def __init__(self, *, ephemeral=True, ephemeral_error=None):
        self.ephemeral = ephemeral
        self.ephemeral_error = ephemeral_error
        self.post_message = AsyncMock(return_value={"channel": "D1", "ts": "1.1"})
        self.post_ephemeral = AsyncMock(side_effect=ephemeral_error, return_value=True)

    async def fetch_capabilities(self, *, connection=None):
        caps = await WellBehavedFakeAdapter().fetch_capabilities()
        caps.rendering.controls.ephemeral = self.ephemeral
        return caps


class _OutboxStore:
    """The outbox rows the note claims, by key."""

    def __init__(self):
        self.rows = {}

    async def fetch(self, *, project_id, key):
        return self.rows.get(key)

    async def record(self, *, project_id, event):
        row = self.rows.get(event.key)
        if row is None:
            row = ChannelOutboxEvent(
                id=uuid4(),
                connection_id=event.connection_id,
                space_id=event.space_id,
                turn_id=event.turn_id,
                key=event.key,
                state=ChannelDeliveryState.CREATED,
                data=event.data,
            )
            self.rows[event.key] = row
        return row

    async def transition(self, *, project_id, event_id, state, status=None, data=None):
        for key, row in self.rows.items():
            if row.id == event_id:
                self.rows[key] = row.model_copy(
                    update={"state": state, "data": data or row.data}
                )
                return self.rows[key]


def _dispatcher(adapter, *, connection=None):
    store = _OutboxStore()
    dao = MagicMock()
    dao.fetch_outbox_event_by_key = AsyncMock(side_effect=store.fetch)
    dao.record_outbox_event = AsyncMock(side_effect=store.record)
    dao.transition_outbox_event = AsyncMock(side_effect=store.transition)
    service = MagicMock()
    service.channels_dao = dao
    service.fetch_connection = AsyncMock(return_value=connection or _connection())

    async def _capabilities(**kwargs):
        return await adapter.fetch_capabilities()

    service.fetch_capabilities = _capabilities
    service.adapter_registry = SimpleNamespace(get=lambda channel: adapter)
    return InboxDispatcher(channels_service=service, run_admission=MagicMock()), store


def _refusal(*, reason, kind):
    return ChannelRefusal(
        reason=reason,
        space=ChannelSpace(
            id=uuid4(),
            connection_id=uuid4(),
            kind=kind,
            external_key=uuid4(),
            data=ChannelSpaceData(external_locator=_LOCATOR),
        ),
        agent=_agent(),
        sender_id="BEN",
    )


_NOTE_CONNECTION_ID = uuid4()


async def _note(dispatcher, refusal, event=None):
    await dispatcher._send_refusal_note(
        project_id=uuid4(),
        connection_id=_NOTE_CONNECTION_ID,
        event=event or _event(sender="BEN"),
        refusal=refusal,
    )


def _text(call):
    return call.kwargs["content"][0]["text"]


async def test_a_refused_person_in_a_channel_gets_one_ephemeral_note_a_day():
    adapter = _NoteAdapter()
    dispatcher, store = _dispatcher(adapter)
    refusal = _refusal(
        reason=ChannelRefusalReason.SENDER_NOT_LISTED, kind=ChannelSpaceKind.TOPIC
    )

    await _note(dispatcher, refusal)
    await _note(dispatcher, refusal)

    adapter.post_ephemeral.assert_awaited_once()
    # the repeat stopped at the note key: no connection read
    dispatcher.channels_service.fetch_connection.assert_awaited_once()
    call = adapter.post_ephemeral.await_args
    assert call.kwargs["recipient_id"] == "BEN"
    assert _text(call) == REFUSED_SENDER_TEXT
    adapter.post_message.assert_not_awaited()
    (row,) = store.rows.values()
    assert row.state is ChannelDeliveryState.SENT


async def test_a_dm_while_dms_are_off_gets_a_normal_reply_once():
    adapter = _NoteAdapter()
    dispatcher, _ = _dispatcher(adapter)
    refusal = _refusal(
        reason=ChannelRefusalReason.SPACE_OFF, kind=ChannelSpaceKind.PRIVATE
    )

    await _note(dispatcher, refusal)
    await _note(dispatcher, refusal)

    adapter.post_message.assert_awaited_once()
    call = adapter.post_message.await_args
    assert _text(call) == REFUSED_DIRECT_MESSAGE_TEXT
    # top level in a DM
    assert "thread_ts" not in call.kwargs["locator"]


async def test_an_off_channel_note_says_the_channel_is_off():
    adapter = _NoteAdapter()
    dispatcher, _ = _dispatcher(adapter)

    await _note(
        dispatcher,
        _refusal(reason=ChannelRefusalReason.SPACE_OFF, kind=ChannelSpaceKind.TOPIC),
    )

    assert _text(adapter.post_ephemeral.await_args) == REFUSED_CHANNEL_TEXT


async def test_a_telegram_group_gets_no_note():
    adapter = _NoteAdapter(ephemeral=False)
    dispatcher, store = _dispatcher(adapter)

    await _note(
        dispatcher,
        _refusal(
            reason=ChannelRefusalReason.SENDER_NOT_LISTED,
            kind=ChannelSpaceKind.GROUP,
        ),
    )

    adapter.post_message.assert_not_awaited()
    adapter.post_ephemeral.assert_not_awaited()
    assert store.rows == {}


async def test_a_refused_ephemeral_is_logged_and_dropped_never_retried():
    adapter = _NoteAdapter(ephemeral_error=RuntimeError("user_not_in_channel"))
    dispatcher, store = _dispatcher(adapter)
    refusal = _refusal(
        reason=ChannelRefusalReason.SENDER_NOT_LISTED, kind=ChannelSpaceKind.TOPIC
    )

    await _note(dispatcher, refusal)
    await _note(dispatcher, refusal)

    adapter.post_ephemeral.assert_awaited_once()
    (row,) = store.rows.values()
    assert row.state is ChannelDeliveryState.FAILED


async def test_a_new_day_gets_a_new_note(monkeypatch):
    import oss.src.tasks.asyncio.channels.inbox as inbox

    adapter = _NoteAdapter()
    dispatcher, store = _dispatcher(adapter)
    refusal = _refusal(
        reason=ChannelRefusalReason.SENDER_NOT_LISTED, kind=ChannelSpaceKind.TOPIC
    )

    class _Day1(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 28, 23, 0, tzinfo=timezone.utc)

    class _Day2(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 29, 1, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(inbox, "datetime", _Day1)
    await _note(dispatcher, refusal)
    monkeypatch.setattr(inbox, "datetime", _Day2)
    await _note(dispatcher, refusal)

    assert adapter.post_ephemeral.await_count == 2
    assert len(store.rows) == 2


async def test_dispatch_sends_the_note_and_opens_no_turn():
    adapter = _NoteAdapter()
    dispatcher, _ = _dispatcher(adapter)
    refusal = _refusal(
        reason=ChannelRefusalReason.SENDER_NOT_LISTED, kind=ChannelSpaceKind.TOPIC
    )
    dispatcher.channels_service.resolve_or_refuse = AsyncMock(
        return_value=SimpleNamespace(resolution=None, refusal=refusal)
    )
    dispatcher.channels_service.open_turn = AsyncMock()

    await dispatcher.dispatch_event(
        project_id=uuid4(), connection_id=uuid4(), event=_event(sender="BEN")
    )

    adapter.post_ephemeral.assert_awaited_once()
    dispatcher.channels_service.open_turn.assert_not_awaited()


def test_note_rows_carry_no_thread():
    data = ChannelOutboxEventData(processed={"attempt": "x"})
    assert data.processed == {"attempt": "x"}


async def test_limits_of_an_agent_that_resolves_to_nothing_are_refused():
    """An archived agent cannot be told private or not: fail closed."""

    from oss.src.core.workflows.types import AgentReferenceUnresolved

    agent = _agent()
    dao = _dao(agent=agent)
    service = _guarded_service(dao, refuse=False)
    service.workflows_service.resolve_agent_artifact_id = AsyncMock(
        side_effect=AgentReferenceUnresolved()
    )

    with pytest.raises(SharedItemNotFound):
        await service.create_grant(
            project_id=uuid4(),
            user_id=uuid4(),
            guard_user_id=uuid4(),
            grant=ChannelGrantCreate(
                agent_id=agent.id,
                effect=ChannelGrantEffect.ALLOW,
                kind=ChannelSpaceKind.PRIVATE,
                data=ChannelGrantData(),
            ),
        )


async def test_someone_else_cannot_move_a_private_agents_default_grant():
    agent = _agent()
    grant = _grant(agent, effect=ChannelGrantEffect.ALLOW, space_id=uuid4())
    dao = _dao(agent=agent)
    dao.query_grants = AsyncMock(return_value=[grant])
    dao.fetch_default_grant = AsyncMock(return_value=None)
    service = _guarded_service(dao, refuse=True)

    with pytest.raises(SharedItemNotFound):
        await service.set_grant_default(
            project_id=uuid4(),
            user_id=uuid4(),
            guard_user_id=uuid4(),
            grant_id=grant.id,
        )
    # refused inside the write, with the agent to guard
    assert dao.edit_grant.await_args.kwargs["guard_artifact_ids"]


async def test_a_refused_default_move_leaves_the_old_default_in_place():
    """The first write (clearing the old default) checks both agents' owners,
    so a refusal for the new agent changes nothing."""

    agent = _agent()
    old_default = _grant(agent, effect=ChannelGrantEffect.ALLOW, space_id=uuid4())
    old_default.flags.is_default = True
    new_grant = _grant(
        agent, effect=ChannelGrantEffect.ALLOW, space_id=old_default.space_id
    )
    dao = _dao(agent=agent)
    dao.query_grants = AsyncMock(return_value=[old_default, new_grant])
    dao.fetch_default_grant = AsyncMock(return_value=old_default)
    service = _guarded_service(dao, refuse=True)

    with pytest.raises(SharedItemNotFound):
        await service.set_grant_default(
            project_id=uuid4(),
            user_id=uuid4(),
            guard_user_id=uuid4(),
            grant_id=new_grant.id,
        )
    (call,) = dao.edit_grant.await_args_list
    assert call.kwargs["grant"].id == old_default.id
    assert len(call.kwargs["guard_artifact_ids"]) == 2


async def test_an_excluded_person_writing_while_the_binding_is_off_is_not_stored():
    agent = _agent(senders=["ANA"])
    agent.flags.is_active = False
    dao = _dao(agent=agent)

    routing = await _service(dao).resolve_or_refuse(
        project_id=uuid4(), connection_id=uuid4(), event=_event(sender="BEN")
    )

    assert routing.resolution is None
    assert routing.refusal is None  # silent: the binding is off
    dao.attach_event_to_space.assert_not_awaited()


async def test_an_excluded_person_writing_in_a_switched_off_place_is_not_stored():
    agent = _agent(senders=["ANA"])
    dao = _dao(agent=agent)
    dao.fetch_space_by_key = AsyncMock(
        return_value=ChannelSpace(
            id=uuid4(),
            connection_id=uuid4(),
            kind=ChannelSpaceKind.GROUP,
            external_key=uuid4(),
            data=ChannelSpaceData(external_locator=_LOCATOR),
            flags={"is_active": False},
        )
    )

    routing = await _service(dao).resolve_or_refuse(
        project_id=uuid4(), connection_id=uuid4(), event=_event(sender="BEN")
    )

    assert routing.resolution is None and routing.refusal is None
    dao.attach_event_to_space.assert_not_awaited()


async def test_pointing_an_off_binding_at_someone_elses_private_agent_is_refused():
    """Otherwise a binding's limits could be changed on another agent and the
    binding pointed back at the private agent."""

    agent = _agent(senders=[])
    agent.flags.is_active = False
    dao = _dao(agent=agent)
    service = _guarded_service(dao, refuse=True)
    source_artifact, destination_artifact = uuid4(), uuid4()
    destination_revision = str(uuid4())

    async def _resolve(*, project_id, references):
        ids = {str(ref.id) for ref in references}
        return destination_artifact if destination_revision in ids else source_artifact

    service.workflows_service.resolve_agent_artifact_id = _resolve

    with pytest.raises(SharedItemNotFound):
        await service.edit_agent(
            project_id=uuid4(),
            user_id=uuid4(),
            guard_user_id=uuid4(),
            agent=ChannelAgentEdit(
                id=agent.id,
                data=ChannelAgentDataEdit(
                    references={"workflow_revision": {"id": destination_revision}}
                ),
            ),
        )
    assert list(dao.edit_agent.await_args.kwargs["guard_artifact_ids"]) == [
        destination_artifact
    ]


async def test_someone_else_cannot_create_an_off_binding_with_a_people_list():
    """The owner rule covers creating a binding too, on or off."""

    agent = _agent()
    dao = _dao(agent=agent)
    dao.fetch_connection = AsyncMock(return_value=_connection())
    service = _guarded_service(dao, refuse=True)

    with pytest.raises(SharedItemNotFound):
        await service.create_agent(
            project_id=uuid4(),
            user_id=uuid4(),
            guard_user_id=uuid4(),
            agent=ChannelAgentCreate(
                connection_id=uuid4(),
                slug="off",
                data=ChannelAgentData(
                    references={"workflow_revision": {"id": str(uuid4())}},
                    audience=ChannelAgentAudience(senders=["U-BEN"]),
                ),
                flags=ChannelAgentFlags(is_active=False),
            ),
        )


async def test_an_off_binding_without_a_people_list_is_created_as_before():
    agent = _agent()
    dao = _dao(agent=agent)
    dao.fetch_connection = AsyncMock(return_value=_connection())
    service = _guarded_service(dao, refuse=True)

    await service.create_agent(
        project_id=uuid4(),
        user_id=uuid4(),
        guard_user_id=uuid4(),
        agent=ChannelAgentCreate(
            connection_id=uuid4(),
            slug="off",
            data=ChannelAgentData(
                references={"workflow_revision": {"id": str(uuid4())}}
            ),
            flags=ChannelAgentFlags(is_active=False),
        ),
    )
    assert dao.create_agent.await_args.kwargs["guard_artifact_id"] is None
    # no list: the installation is not touched
    assert "installation_senders" not in dao.create_agent.await_args.kwargs


async def test_a_people_list_change_is_also_written_to_the_installation():
    """Rollout: pods of the previous release read the installation's list."""

    agent = _agent(senders=["ANA"])
    agent.flags.is_active = False
    dao = _dao(agent=agent)
    service = _guarded_service(dao, refuse=False)
    project_id = uuid4()

    await service.edit_agent(
        project_id=project_id,
        user_id=uuid4(),
        guard_user_id=uuid4(),
        agent=ChannelAgentEdit(
            id=agent.id, data=ChannelAgentDataEdit(audience={"senders": ["BEN"]})
        ),
    )
    # in the same write as the binding
    assert dao.edit_agent.await_args.kwargs["installation_senders"] == ["BEN"]

    await service.edit_agent(
        project_id=project_id,
        user_id=uuid4(),
        guard_user_id=uuid4(),
        agent=ChannelAgentEdit(id=agent.id, name="renamed"),
    )
    assert "installation_senders" not in dao.edit_agent.await_args.kwargs
