from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.sessions.records.dtos import (
    RECORD_SETTLED_BY_ATTRIBUTE,
    SessionRecord,
)


AGENT_FAILURE_PROMPT_LIMIT = 4000
AGENT_FAILURE_MESSAGE_LIMIT = 1000

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
    message: Optional[str] = None
    prompt: Optional[str] = None


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


def _tool_fields(tool_call: SessionRecord) -> Dict[str, Optional[str]]:
    attributes = tool_call.attributes or {}
    name = _text(attributes.get("name"))
    if name is None:
        return {}

    fields = {"tool_name": name, "tool_kind": _tool_kind(name)}
    tool_input = attributes.get("input")
    if _bare_tool_name(name) == _EXTERNAL_TOOL_RUNNER and isinstance(tool_input, dict):
        fields["tool_integration"] = _text(tool_input.get("integration"))
        fields["tool_action"] = _text(tool_input.get("tool"))
    return fields


def _prompt(failure: AgentFailure, context: List[SessionRecord]) -> Optional[str]:
    messages = [
        (record, text)
        for record in context
        if record.record_type == "message"
        and record.record_source == "user"
        and (text := _text((record.attributes or {}).get("text")))
    ]
    same_turn = [
        text
        for record, text in messages
        if failure.turn_id is not None and record.turn_id == failure.turn_id
    ]
    if same_turn:
        return same_turn[-1][:AGENT_FAILURE_PROMPT_LIMIT]

    # A continuation turn holds no user message of its own.
    if failure.occurred_at is None:
        return None
    earlier = [
        text
        for record, text in messages
        if record.timestamp is not None and record.timestamp <= failure.occurred_at
    ]
    return earlier[-1][:AGENT_FAILURE_PROMPT_LIMIT] if earlier else None


def with_turn_context(
    failure: AgentFailure, context: List[SessionRecord]
) -> AgentFailure:
    """`context` is in send order, so the last match is the latest record."""
    update: Dict[str, Optional[str]] = {"prompt": _prompt(failure, context)}
    if failure.tool_call_id is not None:
        for record in reversed(context):
            if (
                record.record_type == "tool_call"
                and (record.attributes or {}).get("id") == failure.tool_call_id
            ):
                update.update(_tool_fields(record))
                break
    return failure.model_copy(update=update)
