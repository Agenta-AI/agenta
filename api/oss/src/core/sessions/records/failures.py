from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from orjson import OPT_SORT_KEYS, dumps
from pydantic import BaseModel

from oss.src.core.sessions.records.dtos import (
    RECORD_SETTLED_BY_ATTRIBUTE,
    SessionRecord,
)
from oss.src.core.sessions.turns.dtos import SessionTurn


AGENT_FAILURE_PROMPT_LIMIT = 4000
AGENT_FAILURE_MESSAGE_LIMIT = 1000
AGENT_FAILURE_TOOL_INPUT_LIMIT = 2000
# The last messages before a failure: about two turns of user and agent text.
AGENT_FAILURE_CONVERSATION_LIMIT = 6

_PLATFORM_TOOL_PREFIXES = ("mcp__agenta-tools__", "mcp.agenta-tools.")
_MCP_TOOL_PREFIXES = ("mcp__", "mcp.")
_EXTERNAL_TOOL_RUNNER = "run_tool"


class AgentFailureSource(str, Enum):
    TOOL = "tool"
    MCP_SERVER = "mcp_server"
    SANDBOX = "sandbox"
    MODEL = "model"
    HARNESS = "harness"
    TIME_LIMIT = "time_limit"
    QUOTA = "quota"
    ACCESS = "access"
    PLATFORM = "platform"
    RUNNER = "runner"
    TRIGGER = "trigger"


class AgentFailureMessage(BaseModel):
    role: str  # the record source: "user" or "agent"
    text: str


class AgentFailure(BaseModel):
    record_id: UUID
    project_id: UUID
    session_id: str
    turn_id: Optional[str] = None
    occurred_at: Optional[datetime] = None
    source: AgentFailureSource
    code: Optional[str] = None
    detail_code: Optional[str] = None
    retryable: Optional[bool] = None
    settled_by: Optional[str] = None
    tool_call_id: Optional[str] = None
    tool_name: Optional[str] = None
    tool_kind: Optional[str] = None
    tool_integration: Optional[str] = None
    tool_action: Optional[str] = None
    server_name: Optional[str] = None
    http_status: Optional[int] = None
    # What ran: the model the runner stamps on the failure record, and the turn's revision.
    model: Optional[str] = None
    harness: Optional[str] = None
    workflow_id: Optional[str] = None
    workflow_slug: Optional[str] = None
    revision_id: Optional[str] = None
    revision_version: Optional[str] = None
    # Customer text, sent only with the detail flag.
    message: Optional[str] = None
    prompt: Optional[str] = None
    tool_input: Optional[str] = None
    conversation: Optional[List[AgentFailureMessage]] = None


_SOURCE_BY_CODE: Dict[str, AgentFailureSource] = {
    "sandbox_capacity": AgentFailureSource.SANDBOX,
    "sandbox_gone": AgentFailureSource.SANDBOX,
    "credential_delivery_failed": AgentFailureSource.SANDBOX,
    "provider_error": AgentFailureSource.MODEL,
    "upstream_error": AgentFailureSource.MODEL,
    "upstream_rejected": AgentFailureSource.MODEL,
    "rate_limited": AgentFailureSource.MODEL,
    "model_unavailable": AgentFailureSource.MODEL,
    "output_limit_exceeded": AgentFailureSource.MODEL,
    "harness_init_timeout": AgentFailureSource.HARNESS,
    "subscription_login_required": AgentFailureSource.HARNESS,
    "subscription_login_refreshed": AgentFailureSource.HARNESS,
    "tool_call_time_limit": AgentFailureSource.TIME_LIMIT,
    "run_idle_time_limit": AgentFailureSource.TIME_LIMIT,
    "run_first_response_time_limit": AgentFailureSource.TIME_LIMIT,
    "run_total_time_limit": AgentFailureSource.TIME_LIMIT,
    "turn_time_limit_reached": AgentFailureSource.TIME_LIMIT,
    "starter_credits_exhausted": AgentFailureSource.QUOTA,
    "starter_credits_program_paused": AgentFailureSource.QUOTA,
    "starter_credits_unavailable": AgentFailureSource.QUOTA,
    "wallet_balance_exhausted": AgentFailureSource.QUOTA,
    "concurrent_turns_limit": AgentFailureSource.QUOTA,
    "builtin_models_not_enabled": AgentFailureSource.QUOTA,
    "policy_denied": AgentFailureSource.QUOTA,
    "access_denied": AgentFailureSource.ACCESS,
    "execution_lost": AgentFailureSource.PLATFORM,
    "runner_capacity": AgentFailureSource.PLATFORM,
    "turn_index_taken": AgentFailureSource.PLATFORM,
    "session_records_incomplete": AgentFailureSource.PLATFORM,
    "runner_error": AgentFailureSource.RUNNER,
    "internal_error": AgentFailureSource.RUNNER,
}


def _text(value: Any) -> Optional[str]:
    return value if isinstance(value, str) else None


def _message(value: Any) -> Optional[str]:
    text = _text(value)
    return None if text is None else text[:AGENT_FAILURE_MESSAGE_LIMIT]


def _detail_code(attributes: Dict[str, Any]) -> Optional[str]:
    detail = attributes.get("detail")
    return _text(detail.get("code")) if isinstance(detail, dict) else None


def _retryable(attributes: Dict[str, Any]) -> Optional[bool]:
    detail = attributes.get("detail")
    retryable = detail.get("retryable") if isinstance(detail, dict) else None
    return retryable if isinstance(retryable, bool) else None


def _http_status(value: Any) -> Optional[int]:
    # bool is an int subclass, and `True` is not an HTTP status.
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def failure_from_record(record: SessionRecord) -> Optional[AgentFailure]:
    """The failure a committed record reports, or None for every other record.

    `attributes` is an open dict filled from the ingest wire, so each value is read
    defensively: a raise here would lose the analytics event for the whole batch.
    """
    if record.quarantined_at is not None:
        return None

    attributes = record.attributes or {}
    base = {
        "record_id": record.record_id,
        "project_id": record.project_id,
        "session_id": record.session_id,
        "turn_id": record.turn_id,
        "occurred_at": record.timestamp or record.created_at,
        "model": _text(attributes.get("model")),
    }

    if record.record_type == "error":
        code = _text(attributes.get("code"))
        return AgentFailure(
            **base,
            source=_SOURCE_BY_CODE.get(code, AgentFailureSource.RUNNER),
            code=code,
            detail_code=_detail_code(attributes),
            retryable=_retryable(attributes),
            settled_by=_text(attributes.get(RECORD_SETTLED_BY_ATTRIBUTE)),
            message=_message(attributes.get("message")),
        )

    if record.record_type == "mcp_server_failed":
        return AgentFailure(
            **base,
            source=AgentFailureSource.MCP_SERVER,
            code=_text(attributes.get("reasonCode")),
            detail_code=_detail_code(attributes),
            retryable=_retryable(attributes),
            server_name=_text(attributes.get("serverName")),
            http_status=_http_status(attributes.get("status")),
            message=_message(attributes.get("message")),
        )

    if (
        record.record_type == "tool_result"
        and attributes.get("isError")
        and not attributes.get("denied")
    ):
        return AgentFailure(
            **base,
            source=AgentFailureSource.TOOL,
            tool_call_id=_text(attributes.get("id")),
            message=_message(attributes.get("output")),
        )

    return None


def _tool_kind(name: str) -> str:
    if name.startswith(_PLATFORM_TOOL_PREFIXES):
        return "platform"
    if name.startswith(_MCP_TOOL_PREFIXES):
        return "mcp"
    return "other"


def _bare_tool_name(name: str) -> str:
    if name.startswith("mcp__"):
        return name.rsplit("__", 1)[-1]
    if name.startswith("mcp."):
        return name.rsplit(".", 1)[-1]
    return name


def _tool_input(value: Any) -> Optional[str]:
    if value is None:
        return None
    try:
        text = dumps(value, option=OPT_SORT_KEYS).decode()
    except TypeError:
        return None
    return text[:AGENT_FAILURE_TOOL_INPUT_LIMIT]


def _tool_fields(tool_call: SessionRecord) -> Dict[str, Optional[str]]:
    attributes = tool_call.attributes or {}
    name = _text(attributes.get("name"))
    if name is None:
        return {}

    tool_input = attributes.get("input")
    fields = {
        "tool_name": name,
        "tool_kind": _tool_kind(name),
        "tool_input": _tool_input(tool_input),
    }
    if _bare_tool_name(name) == _EXTERNAL_TOOL_RUNNER and isinstance(tool_input, dict):
        fields["tool_integration"] = _text(tool_input.get("integration"))
        fields["tool_action"] = _text(tool_input.get("tool"))
    return fields


def turn_fields(turn: SessionTurn) -> Dict[str, Optional[str]]:
    """What ran the failed turn: its harness and its revision references."""
    fields: Dict[str, Optional[str]] = {"harness": turn.harness_kind.value}
    for reference in turn.references or []:
        if reference.key == "workflow":
            fields["workflow_id"] = str(reference.id) if reference.id else None
            fields["workflow_slug"] = reference.slug
        elif reference.key == "workflow_revision":
            fields["revision_id"] = str(reference.id) if reference.id else None
            fields["revision_version"] = reference.version
    return fields


def _conversation(messages: List[SessionRecord]) -> List[AgentFailureMessage]:
    conversation = []
    for record in messages:
        text = _text((record.attributes or {}).get("text"))
        if text:
            conversation.append(
                AgentFailureMessage(
                    role=record.record_source or "agent",
                    text=text[:AGENT_FAILURE_MESSAGE_LIMIT],
                )
            )
    return conversation


def with_turn_context(
    failure: AgentFailure,
    *,
    tool_calls: List[SessionRecord],
    prompt: Optional[SessionRecord] = None,
    messages: Optional[List[SessionRecord]] = None,
    turn: Optional[SessionTurn] = None,
) -> AgentFailure:
    """`tool_calls` and `messages` are in send order, so the last tool match is the
    latest call."""
    update: Dict[str, Any] = turn_fields(turn) if turn is not None else {}
    if prompt is not None:
        text = _text((prompt.attributes or {}).get("text"))
        update["prompt"] = text[:AGENT_FAILURE_PROMPT_LIMIT] if text else None
    if messages:
        update["conversation"] = _conversation(messages) or None
    if failure.tool_call_id is not None:
        for record in reversed(tool_calls):
            if (
                record.record_type == "tool_call"
                and (record.attributes or {}).get("id") == failure.tool_call_id
            ):
                update.update(_tool_fields(record))
                break
    return failure.model_copy(update=update)
