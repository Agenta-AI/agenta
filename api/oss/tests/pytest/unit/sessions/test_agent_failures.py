"""Agent failures reach PostHog once each, with the right reason and without leaking text."""

import asyncio
import zlib
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from orjson import dumps

from oss.src.tasks.asyncio.sessions import failure_reporter as reporter_module
from oss.src.core.sessions.records.dtos import SessionRecord
from oss.src.tasks.asyncio.sessions.failure_reporter import AgentFailureReporter
from oss.src.core.sessions.records.failures import (
    AgentFailure,
    AgentFailureSource,
    failure_from_record,
    turn_fields,
    with_turn_context,
)
from oss.src.core.sessions.turns.dtos import SessionTurn, SessionTurnQuery
from oss.src.core.sessions.types import SessionReference
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.shared.dtos import Reference
from oss.src.core.triggers.dtos import (
    TriggerSchedule,
    TriggerScheduleData,
    TriggerScheduleFlags,
)
from oss.src.core.workflows.dtos import ResolvedTarget
from oss.src.core.workflows.types import (
    WorkflowDetachedStartNeverSent,
    WorkflowDetachedStartRejected,
    WorkflowServiceUrlMissing,
)
from oss.src.tasks.asyncio.sessions.records_worker import RecordsWorker
from oss.src.tasks.asyncio.triggers.dispatcher import TriggersDispatcher
from oss.src.utils.env import env
from oss.tests.pytest.utils.principals import (
    any_principal,
    register_allowing_access_service,
)
from oss.tests.pytest.utils.sharing import (
    NoopRunAdmission,
    register_sharing_service_for_tests,
)


PROJECT = UUID("11111111-1111-4111-8111-111111111111")
ORGANIZATION = UUID("22222222-2222-4222-8222-222222222222")
OWNER = UUID("33333333-3333-4333-8333-333333333333")
RECORD = UUID("44444444-4444-4444-8444-444444444444")
SESSION = "sess-1"
TURN = "turn-1"
RUN_TURN = "55555555-5555-4555-8555-555555555555"
WORKFLOW = UUID("66666666-6666-4666-8666-666666666666")
REVISION = UUID("77777777-7777-4777-8777-777777777777")
MODEL = "anthropic/haiku"
AT = datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc)


def _record(record_type, attributes=None, **overrides):
    fields = {
        "record_id": RECORD,
        "project_id": PROJECT,
        "session_id": SESSION,
        "turn_id": TURN,
        "timestamp": AT,
        "record_type": record_type,
        "attributes": attributes,
    }
    return SessionRecord(**{**fields, **overrides})


def _user_message(text, *, turn_id=TURN, timestamp=AT - timedelta(minutes=1)):
    return _record(
        "message",
        {"text": text},
        record_id=uuid4(),
        record_source="user",
        turn_id=turn_id,
        timestamp=timestamp,
    )


def _tool_call(name, tool_input=None, *, call_id="call-1"):
    return _record(
        "tool_call",
        {"id": call_id, "name": name, "input": tool_input},
        record_id=uuid4(),
    )


def _tool_failure(**overrides):
    fields = {
        "record_id": RECORD,
        "project_id": PROJECT,
        "session_id": SESSION,
        "turn_id": TURN,
        "occurred_at": AT,
        "source": AgentFailureSource.TOOL,
        "tool_call_id": "call-1",
    }
    return AgentFailure(**{**fields, **overrides})


# --------------------------------------------------------------- failure_from_record


@pytest.mark.parametrize(
    "code,source",
    [
        ("sandbox_gone", "sandbox"),
        ("rate_limited", "model"),
        ("harness_init_timeout", "harness"),
        ("run_idle_time_limit", "time_limit"),
        ("starter_credits_program_paused", "quota"),
        ("access_denied", "access"),
        ("execution_lost", "platform"),
        ("internal_error", "runner"),
        ("a_code_added_next_month", "runner"),
        (None, "runner"),
        (42, "runner"),
    ],
)
def test_an_error_record_maps_its_code_to_a_source(code, source):
    failure = failure_from_record(_record("error", {"code": code, "message": "boom"}))

    assert failure.source.value == source
    assert failure.code == (code if isinstance(code, str) else None)
    assert failure.message == "boom"


def test_an_error_record_keeps_its_reason_fields():
    failure = failure_from_record(
        _record(
            "error",
            {
                "code": "execution_lost",
                "message": "lost",
                "detail": {"retryable": True},
                "settled_by": "watchdog",
            },
        )
    )

    assert failure.model_dump(exclude_none=True) == {
        "record_id": RECORD,
        "project_id": PROJECT,
        "session_id": SESSION,
        "turn_id": TURN,
        "occurred_at": AT,
        "source": AgentFailureSource.PLATFORM,
        "code": "execution_lost",
        "retryable": True,
        "settled_by": "watchdog",
        "message": "lost",
    }


def test_an_mcp_server_failure_names_the_server():
    failure = failure_from_record(
        _record(
            "mcp_server_failed",
            {
                "serverName": "github",
                "reasonCode": "handshake_unreachable",
                "status": 503,
                "message": "no answer",
                "detail": {"retryable": False},
            },
        )
    )

    assert failure.source is AgentFailureSource.MCP_SERVER
    assert failure.code == "handshake_unreachable"
    assert failure.server_name == "github"
    assert failure.http_status == 503
    assert failure.message == "no answer"
    assert failure.retryable is False


def test_a_failed_tool_result_is_a_tool_failure():
    failure = failure_from_record(
        _record("tool_result", {"id": "call-1", "isError": True, "output": "bad args"})
    )

    assert failure.source is AgentFailureSource.TOOL
    assert failure.tool_call_id == "call-1"
    assert failure.message == "bad args"


@pytest.mark.parametrize(
    "record",
    [
        _record("tool_result", {"id": "c", "isError": True, "denied": True}),
        _record("tool_result", {"id": "c", "output": "fine"}),
        _record("done", {"stopReason": "cancelled"}),
        _record("done", {"stopReason": "error"}),
        _record("message", {"text": "hi"}),
        _record("error", {"code": "sandbox_gone"}, quarantined_at=AT),
    ],
    ids=[
        "denied_tool_result",
        "successful_tool_result",
        "cancelled_done",
        "error_done",
        "message",
        "quarantined_error",
    ],
)
def test_records_that_are_not_failures_report_nothing(record):
    assert failure_from_record(record) is None


@pytest.mark.parametrize(
    "record",
    [
        _record("error", None),
        _record("error", {"message": {"nested": 1}, "detail": "not-a-dict"}),
        _record("mcp_server_failed", {"status": True, "serverName": 7}),
    ],
    ids=["no_attributes", "wrong_error_types", "wrong_mcp_types"],
)
def test_malformed_attributes_read_as_absent(record):
    failure = failure_from_record(record)

    assert failure.message is None
    assert failure.retryable is None
    assert failure.http_status is None
    assert failure.server_name is None


def test_a_non_text_tool_output_has_no_message():
    failure = failure_from_record(
        _record("tool_result", {"id": "c", "isError": True, "output": {"a": 1}})
    )

    assert failure.source is AgentFailureSource.TOOL
    assert failure.message is None


def test_a_long_message_is_cut():
    failure = failure_from_record(_record("error", {"message": "x" * 1500}))

    assert failure.message == "x" * 1000


# ---------------------------------------------------------------- with_turn_context


@pytest.mark.parametrize(
    "name,tool_input,kind,integration,action",
    [
        (
            "mcp__agenta-tools__run_tool",
            {"integration": "github", "tool": "FIND_PULL_REQUESTS"},
            "platform",
            "github",
            "FIND_PULL_REQUESTS",
        ),
        (
            "mcp.agenta-tools.run_tool",
            {"integration": "slack", "tool": "SEND_MESSAGE"},
            "platform",
            "slack",
            "SEND_MESSAGE",
        ),
        (
            "run_tool",
            {"integration": "github", "tool": "GET_ISSUE"},
            "other",
            "github",
            "GET_ISSUE",
        ),
        ("mcp__agenta-tools__commit_revision", {"x": 1}, "platform", None, None),
        ("mcp__linear__list_issues", {"integration": "no"}, "mcp", None, None),
        ("mcp.linear.list_issues", None, "mcp", None, None),
        ("bash", {"command": "ls"}, "other", None, None),
        ("mcp__agenta-tools__run_tool", "not-a-dict", "platform", None, None),
    ],
)
def test_the_tool_call_names_the_failed_tool(
    name, tool_input, kind, integration, action
):
    failure = with_turn_context(
        _tool_failure(), tool_calls=[_tool_call(name, tool_input)]
    )

    assert failure.tool_name == name
    assert failure.tool_kind == kind
    assert failure.tool_integration == integration
    assert failure.tool_action == action


def test_another_call_in_the_turn_is_not_the_failed_tool():
    failure = with_turn_context(
        _tool_failure(),
        tool_calls=[
            _tool_call("bash", call_id="call-2"),
            _tool_call("grep", call_id="call-1"),
        ],
    )

    assert failure.tool_name == "grep"


def test_the_prompt_is_the_given_user_message():
    failure = with_turn_context(
        _tool_failure(), tool_calls=[], prompt=_user_message("this one")
    )

    assert failure.prompt == "this one"


def test_a_long_prompt_is_cut():
    failure = with_turn_context(
        _tool_failure(), tool_calls=[], prompt=_user_message("p" * 5000)
    )

    assert failure.prompt == "p" * 4000


def _turn(references=None, harness_kind="claude"):
    return SessionTurn(
        project_id=PROJECT,
        session_id=SESSION,
        turn_id=UUID(RUN_TURN),
        stream_id=uuid4(),
        turn_index=0,
        harness_kind=harness_kind,
        references=references,
    )


_RUN_REFERENCES = [
    SessionReference(key="workflow", id=WORKFLOW, slug="pr-reviewer"),
    SessionReference(key="workflow_variant", id=uuid4(), slug="pr-reviewer.default"),
    SessionReference(key="workflow_revision", id=REVISION, version="26"),
]


def test_the_turn_fields_name_the_harness_and_revision():
    assert turn_fields(_turn(_RUN_REFERENCES)) == {
        "harness": "claude",
        "workflow_id": str(WORKFLOW),
        "workflow_slug": "pr-reviewer",
        "revision_id": str(REVISION),
        "revision_version": "26",
    }


@pytest.mark.parametrize(
    "record",
    [
        _record("error", {"code": "x", "model": MODEL}),
        _record("mcp_server_failed", {"serverName": "s", "model": MODEL}),
        _record("tool_result", {"id": "c", "isError": True, "model": MODEL}),
    ],
)
def test_every_failure_keeps_the_model_the_runner_stamped(record):
    assert failure_from_record(record).model == MODEL


def test_a_failure_from_an_older_runner_has_no_model():
    assert (
        failure_from_record(_record("error", {"code": "x", "model": 3})).model is None
    )


def test_the_failed_tool_input_is_kept_and_cut():
    failure = with_turn_context(
        _tool_failure(),
        tool_calls=[_tool_call("bash", {"command": "x" * 3000})],
    )

    assert failure.tool_input.startswith('{"command":"xxx')
    assert len(failure.tool_input) == 2000


def test_the_conversation_keeps_text_messages_in_order():
    agent_reply = _record(
        "message", {"text": "a" * 1500}, record_id=uuid4(), record_source="agent"
    )
    no_text = _record("message", {"text": ""}, record_id=uuid4(), record_source="agent")

    failure = with_turn_context(
        _tool_failure(),
        tool_calls=[],
        messages=[_user_message("fix the bug"), agent_reply, no_text],
    )

    assert [(m.role, m.text) for m in failure.conversation] == [
        ("user", "fix the bug"),
        ("agent", "a" * 1000),
    ]


# --------------------------------------------------------------------- the reporter


class _PostHog:
    def __init__(self):
        self.events = []

    def capture(self, event, **kwargs):
        self.events.append({"event": event, **kwargs})


@pytest.fixture
def posthog(monkeypatch):
    fake = _PostHog()
    monkeypatch.setattr(reporter_module, "_load_posthog", lambda: fake)
    monkeypatch.setattr(reporter_module, "is_ee", lambda: True)
    monkeypatch.setattr(env.posthog, "agent_failure_details", False)
    monkeypatch.setattr(
        reporter_module.db_manager,
        "get_user_with_id",
        AsyncMock(return_value=SimpleNamespace(email="owner@example.com")),
    )
    return fake


def _reporter(
    *,
    tool_calls=(),
    prompt=None,
    messages=(),
    owner_user_id=OWNER,
    turn=None,
):
    records_dao = MagicMock()
    records_dao.get_turn_tool_calls = AsyncMock(return_value=list(tool_calls))
    records_dao.get_latest_user_message = AsyncMock(return_value=prompt)
    records_dao.get_recent_messages = AsyncMock(return_value=list(messages))
    streams_dao = MagicMock()
    streams_dao.get_by_session_id_including_archived = AsyncMock(
        return_value=SimpleNamespace(owner_user_id=owner_user_id)
    )
    turns_dao = MagicMock()
    turns_dao.query_turns = AsyncMock(return_value=[turn] if turn else [])
    return AgentFailureReporter(
        records_dao=records_dao,
        streams_dao=streams_dao,
        turns_dao=turns_dao,
    )


async def _report(reporter, records):
    await reporter.report(records=records, organization_ids={PROJECT: ORGANIZATION})


_FAILED_TOOL = _record(
    "tool_result", {"id": "call-1", "isError": True, "output": "secret stack trace"}
)
_PROMPT = _user_message("my private prompt")
_CALLS = (_tool_call("bash"),)


def _with_context(**overrides):
    return _reporter(tool_calls=_CALLS, prompt=_PROMPT, **overrides)


@pytest.mark.asyncio
async def test_oss_sends_nothing_and_ee_sends_the_same_records(posthog, monkeypatch):
    monkeypatch.setattr(reporter_module, "is_ee", lambda: False)
    await _report(_with_context(), [_FAILED_TOOL])
    assert posthog.events == []

    monkeypatch.setattr(reporter_module, "is_ee", lambda: True)
    await _report(_with_context(), [_FAILED_TOOL])
    assert [event["uuid"] for event in posthog.events] == [str(RECORD)]


@pytest.mark.asyncio
async def test_ee_sends_the_event_without_text_by_default(posthog):
    await _report(_with_context(), [_FAILED_TOOL])

    assert posthog.events == [
        {
            "event": "agent_failure",
            "distinct_id": "owner@example.com",
            "uuid": str(RECORD),
            "timestamp": AT,
            "properties": {
                "project_id": str(PROJECT),
                "session_id": SESSION,
                "turn_id": TURN,
                "failure_source": "tool",
                "tool_name": "bash",
                "tool_kind": "other",
                "organization_id": str(ORGANIZATION),
            },
        }
    ]


@pytest.mark.asyncio
async def test_the_detail_flag_adds_the_message_and_the_prompt(posthog, monkeypatch):
    monkeypatch.setattr(env.posthog, "agent_failure_details", True)

    await _report(_with_context(), [_FAILED_TOOL])

    properties = posthog.events[0]["properties"]
    assert properties["message"] == "secret stack trace"
    assert properties["prompt"] == "my private prompt"


@pytest.mark.asyncio
async def test_the_reported_prompt_is_cut(posthog, monkeypatch):
    monkeypatch.setattr(env.posthog, "agent_failure_details", True)

    await _report(
        _reporter(tool_calls=_CALLS, prompt=_user_message("p" * 5000)),
        [_FAILED_TOOL],
    )

    assert posthog.events[0]["properties"]["prompt"] == "p" * 4000


@pytest.mark.asyncio
async def test_an_error_code_reaches_the_failure_code_property(posthog):
    reporter = _reporter()

    await _report(reporter, [_record("error", {"code": "rate_limited"})])

    properties = posthog.events[0]["properties"]
    assert properties["failure_source"] == "model"
    assert properties["failure_code"] == "rate_limited"
    assert "code" not in properties
    # No tool name to find and no text allowed out, so nothing is read.
    reporter.records_dao.get_turn_tool_calls.assert_not_awaited()
    reporter.records_dao.get_latest_user_message.assert_not_awaited()
    reporter.records_dao.get_recent_messages.assert_not_awaited()
    # "turn-1" is not a turn id the turns table can hold, so no turn is read.
    reporter.turns_dao.query_turns.assert_not_awaited()


@pytest.mark.asyncio
async def test_the_event_names_the_model_and_revision_without_the_detail_flag(
    posthog,
):
    reporter = _reporter(turn=_turn(_RUN_REFERENCES))

    await _report(
        reporter, [_record("error", {"code": "x", "model": MODEL}, turn_id=RUN_TURN)]
    )

    properties = posthog.events[0]["properties"]
    assert properties["model"] == MODEL
    assert properties["harness"] == "claude"
    assert properties["revision_id"] == str(REVISION)
    assert properties["revision_version"] == "26"
    assert properties["workflow_slug"] == "pr-reviewer"
    reporter.turns_dao.query_turns.assert_awaited_once_with(
        project_id=PROJECT,
        query=SessionTurnQuery(session_id=SESSION, turn_id=UUID(RUN_TURN)),
    )


@pytest.mark.asyncio
async def test_the_tool_input_and_conversation_need_the_detail_flag(
    posthog, monkeypatch
):
    def reporter():
        return _reporter(
            tool_calls=(_tool_call("bash", {"command": "ls"}),),
            prompt=_PROMPT,
            messages=(_PROMPT,),
        )

    await _report(reporter(), [_FAILED_TOOL])
    hidden = posthog.events[-1]["properties"]
    assert "tool_input" not in hidden
    assert "conversation" not in hidden

    monkeypatch.setattr(env.posthog, "agent_failure_details", True)
    shown_reporter = reporter()
    await _report(shown_reporter, [_FAILED_TOOL])
    shown = posthog.events[-1]["properties"]
    assert shown["tool_input"] == '{"command":"ls"}'
    assert shown["conversation"] == [{"role": "user", "text": "my private prompt"}]
    shown_reporter.records_dao.get_recent_messages.assert_awaited_once_with(
        project_id=PROJECT, session_id=SESSION, at_or_before=AT, limit=6
    )


@pytest.mark.asyncio
async def test_an_ownerless_session_is_a_project_event_without_a_person(posthog):
    await _report(_reporter(owner_user_id=None), [_record("error", {"code": "x"})])

    event = posthog.events[0]
    assert event["distinct_id"] == f"project:{PROJECT}"
    assert event["properties"]["$process_person_profile"] is False


@pytest.mark.asyncio
async def test_a_removed_owner_still_sends_the_event(posthog, monkeypatch):
    monkeypatch.setattr(
        reporter_module.db_manager,
        "get_user_with_id",
        AsyncMock(side_effect=LookupError("no user")),
    )

    await _report(_reporter(), [_record("error", {"code": "x"})])

    assert posthog.events[0]["distinct_id"] == f"project:{PROJECT}"


@pytest.mark.asyncio
async def test_a_tool_call_in_the_batch_names_the_tool_without_a_read(posthog):
    reporter = _reporter()

    await _report(reporter, [_tool_call("grep"), _FAILED_TOOL])

    assert posthog.events[0]["properties"]["tool_name"] == "grep"
    reporter.records_dao.get_turn_tool_calls.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_tool_call_from_an_earlier_batch_is_read_from_the_turn(posthog):
    reporter = _with_context()

    await _report(reporter, [_FAILED_TOOL])

    assert posthog.events[0]["properties"]["tool_name"] == "bash"
    reporter.records_dao.get_turn_tool_calls.assert_awaited_once_with(
        project_id=PROJECT, session_id=SESSION, turn_id=TURN
    )
    # Without the detail flag the prompt is never sent, so it is never read.
    reporter.records_dao.get_latest_user_message.assert_not_awaited()


@pytest.mark.asyncio
async def test_the_prompt_is_read_as_one_message_at_the_failure_time(
    posthog, monkeypatch
):
    monkeypatch.setattr(env.posthog, "agent_failure_details", True)
    reporter = _reporter()

    await _report(reporter, [_record("error", {"code": "x"})])

    reporter.records_dao.get_latest_user_message.assert_awaited_once_with(
        project_id=PROJECT, session_id=SESSION, at_or_before=AT
    )


@pytest.mark.asyncio
async def test_one_owner_lookup_serves_a_session(posthog):
    reporter = _with_context()
    other_turn = _record(
        "tool_result",
        {"id": "call-3", "isError": True},
        record_id=uuid4(),
        turn_id="turn-2",
    )

    await _report(reporter, [_FAILED_TOOL, other_turn])

    assert len(posthog.events) == 2
    streams = reporter.streams_dao.get_by_session_id_including_archived
    assert streams.await_count == 1


@pytest.mark.asyncio
async def test_a_failing_posthog_never_raises(posthog, monkeypatch):
    monkeypatch.setattr(posthog, "capture", MagicMock(side_effect=OSError("down")))

    await _report(_reporter(), [_record("error", {"code": "x"})])
    await _reporter().report_trigger_start(
        organization_id=ORGANIZATION,
        project_id=PROJECT,
        session_id=SESSION,
        user_id=OWNER,
        delivery_key="trigger-1:event-1",
        failure_code="start_unconfirmed",
    )

    assert posthog.capture.call_count == 2


@pytest.mark.asyncio
async def test_a_stalled_lookup_ends_at_the_timeout(posthog, monkeypatch):
    monkeypatch.setattr(reporter_module, "REPORT_TIMEOUT_SECONDS", 0.01)

    async def stall(_user_id):
        await asyncio.sleep(60)

    monkeypatch.setattr(reporter_module.db_manager, "get_user_with_id", stall)

    await asyncio.wait_for(
        _report(_reporter(), [_record("error", {"code": "x"})]), timeout=1
    )
    await asyncio.wait_for(
        _reporter().report_trigger_start(
            organization_id=ORGANIZATION,
            project_id=PROJECT,
            session_id=SESSION,
            user_id=OWNER,
            delivery_key="trigger-1:event-1",
            failure_code="start_unconfirmed",
        ),
        timeout=1,
    )

    assert posthog.events == []


async def _report_trigger_start(*, session_id=SESSION):
    await _reporter().report_trigger_start(
        organization_id=ORGANIZATION,
        project_id=PROJECT,
        session_id=session_id,
        user_id=OWNER,
        delivery_key="trigger-1:event-1",
        failure_code="agent_run_failed",
    )


@pytest.mark.asyncio
async def test_a_trigger_start_is_reported_for_the_trigger_owner(posthog, monkeypatch):
    monkeypatch.setattr(env.posthog, "agent_failure_details", True)

    await _report_trigger_start()

    event = posthog.events[0]
    assert event["distinct_id"] == "owner@example.com"
    assert event["properties"] == {
        "project_id": str(PROJECT),
        "session_id": SESSION,
        "failure_source": "trigger",
        "failure_code": "agent_run_failed",
        "organization_id": str(ORGANIZATION),
    }
    reporter_module.db_manager.get_user_with_id.assert_awaited_once_with(str(OWNER))


@pytest.mark.asyncio
async def test_retries_of_one_trigger_event_are_one_posthog_event(posthog):
    # Each retry claims a new session, so only the delivery key ties them together.
    await _report_trigger_start(session_id="session-try-1")
    await _report_trigger_start(session_id="session-try-2")

    first, second = posthog.events
    assert first["uuid"] == second["uuid"]
    assert UUID(first["uuid"]).version == 5


@pytest.mark.asyncio
async def test_oss_reports_no_trigger_start(posthog, monkeypatch):
    monkeypatch.setattr(reporter_module, "is_ee", lambda: False)

    await _reporter().report_trigger_start(
        organization_id=None,
        project_id=PROJECT,
        session_id=SESSION,
        user_id=None,
        delivery_key="trigger-1:event-1",
        failure_code="start_unconfirmed",
    )

    assert posthog.events == []


# ------------------------------------------------------------------ the records worker


def _worker(*, committed, failure_reporter):
    records_dao = AsyncMock()
    records_dao.append_many = AsyncMock(return_value=committed)
    return RecordsWorker(
        service=RecordsService(records_dao=records_dao),
        redis_client=None,
        stream_name="streams:records",
        consumer_group="worker-records",
        failure_reporter=failure_reporter,
    )


def _batch():
    message = {
        "organization_id": str(ORGANIZATION),
        "project_id": str(PROJECT),
        "record_event": {
            "project_id": str(PROJECT),
            "session_id": SESSION,
            "record_index": 0,
            "record_type": "error",
            "turn_id": TURN,
            "attributes": {"code": "sandbox_gone"},
        },
    }
    return [(b"1-1", {b"data": zlib.compress(dumps(message))})]


@pytest.fixture
def community_edition(monkeypatch):
    monkeypatch.setattr(
        "oss.src.tasks.asyncio.sessions.records_worker.is_ee", lambda: False
    )


@pytest.mark.asyncio
async def test_the_committed_batch_reaches_the_reporter_once(community_edition):
    committed = _record("error", {"code": "sandbox_gone"})
    failure_reporter = MagicMock()
    failure_reporter.report = AsyncMock()

    appended, acked = await _worker(
        committed=[committed], failure_reporter=failure_reporter
    ).process_batch(_batch())

    assert (appended, acked) == (1, [b"1-1"])
    failure_reporter.report.assert_awaited_once_with(
        records=[committed], organization_ids={PROJECT: ORGANIZATION}
    )


# ---------------------------------------------------------------------- the dispatcher


def _schedule():
    return TriggerSchedule(
        id=uuid4(),
        created_by_id=OWNER,
        principal=any_principal(),
        flags=TriggerScheduleFlags(is_active=True),
        data=TriggerScheduleData(
            event_key="cron.tick",
            schedule="* * * * *",
            references={"workflow": Reference(slug="wf-1")},
        ),
    )


def _dispatcher(*, failure, failure_reporter):
    dao = MagicMock()
    dao.dedup_seen_schedule = AsyncMock(return_value=False)
    dao.claim_trigger_delivery = AsyncMock(return_value=True)
    dao.update_delivery = AsyncMock()
    dao.abandon_claimed_session = AsyncMock()
    workflows = MagicMock()
    workflows.resolve_request_target = AsyncMock(
        return_value=ResolvedTarget(artifact_id=uuid4(), revision_id=uuid4())
    )
    dispatcher = TriggersDispatcher(
        run_admission=NoopRunAdmission(),
        triggers_dao=dao,
        session_claims_dao=dao,
        workflows_service=workflows,
        dispatch_fn=AsyncMock(side_effect=failure),
        failure_reporter=failure_reporter,
    )
    return dispatcher, dao


@pytest.mark.parametrize(
    "failure,failure_code",
    [
        (
            WorkflowDetachedStartRejected("HTTP 422", failure_code="agent_run_failed"),
            "agent_run_failed",
        ),
        (WorkflowDetachedStartRejected("HTTP 422"), "start_rejected"),
        (
            WorkflowDetachedStartRejected(
                "HTTP 422", failure_code="token sk-123 was refused"
            ),
            "start_rejected",
        ),
        (WorkflowDetachedStartNeverSent("HTTP 502"), "start_never_sent"),
        (WorkflowServiceUrlMissing(), "start_never_sent"),
        (RuntimeError("HTTP 502"), "start_unconfirmed"),
    ],
    ids=[
        "rejected_start",
        "uncoded_rejection",
        "free_text_code",
        "never_sent",
        "no_service_url",
        "unconfirmed_start",
    ],
)
@pytest.mark.asyncio
async def test_a_failed_start_is_reported_and_still_raises(
    monkeypatch, failure, failure_code
):
    register_allowing_access_service(monkeypatch)
    register_sharing_service_for_tests(monkeypatch)
    failure_reporter = MagicMock()
    failure_reporter.report_trigger_start = AsyncMock()
    dispatcher, dao = _dispatcher(failure=failure, failure_reporter=failure_reporter)

    with pytest.raises(type(failure)):
        await dispatcher.dispatch_schedule(
            project_id=PROJECT,
            schedule=_schedule(),
            event_id="sched-1:2026-07-13T00:00:00",
            event={"metadata": {"trigger_slug": "cron.tick", "id": "e"}, "payload": {}},
        )

    schedule_id = dao.claim_trigger_delivery.await_args.kwargs["attribution"]
    failure_reporter.report_trigger_start.assert_awaited_once_with(
        organization_id=ANY,
        project_id=PROJECT,
        session_id=dao.claim_trigger_delivery.await_args.kwargs["session_id"],
        user_id=OWNER,
        delivery_key=f"{schedule_id.configuration_id}:sched-1:2026-07-13T00:00:00",
        failure_code=failure_code,
    )
    reported = failure_reporter.report_trigger_start.await_args.kwargs
    assert reported["organization_id"] is not None


def test_failure_keeps_the_gateway_refusal_code():
    failure = failure_from_record(
        SessionRecord(
            record_id=uuid4(),
            session_id="sess-detail",
            project_id=uuid4(),
            record_type="error",
            attributes={
                "type": "error",
                "message": "refused",
                "code": "policy_denied",
                "detail": {"code": "spend_limit", "retryable": False},
            },
        )
    )

    assert failure.code == "policy_denied"
    assert failure.detail_code == "spend_limit"
