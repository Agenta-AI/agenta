"""Pure event-stream folding: batch = fold(stream), by construction (specs.md).

Events are plain ``{"type", "data"}`` dicts, same wire shape ``adapters/vercel/stream.py``
folds for its own projection.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

Message = Dict[str, Any]
FoldedEvent = Dict[str, Any]


def _pending_tool_name(interaction: Dict[str, Any]) -> Optional[str]:
    """The paused tool's name, from the interaction payload's stable-first candidates.

    Relay/client pauses carry ``payload.toolName`` (the spec name); harness gates carry an
    ACP ``toolCall`` whose ``name``/``title``/``kind`` may each be a display label rather
    than a name, so they are fallbacks in that order (see the approval-boundary workspace).
    """
    payload = interaction.get("payload")
    if not isinstance(payload, dict):
        return None
    name = payload.get("toolName")
    if isinstance(name, str) and name:
        return name
    tool_call = payload.get("toolCall")
    if isinstance(tool_call, dict):
        for key in ("name", "title", "kind"):
            value = tool_call.get(key)
            if isinstance(value, str) and value:
                return value
    return None


def fold(
    events: Iterable[FoldedEvent], *, stop_reason: Optional[str] = None
) -> Dict[str, Any]:
    """Fold a full event turn into ``{messages, stop_reason, pending_interaction}``.

    ``stop_reason`` is the terminal result's value when the caller holds one; it wins over
    the event-derived value because the runner's ``done`` event carries no ``stopReason``
    today (the engine settles it after the pause race, onto the terminal result only).
    """
    messages: List[Message] = []
    open_text: Dict[Any, int] = {}  # message_start id -> index into `messages`
    event_stop_reason: Optional[str] = None
    last_interaction_request: Optional[Dict[str, Any]] = None

    for event in events:
        etype = event.get("type")
        data = event.get("data") or {}

        if etype == "message":
            messages.append({"role": "assistant", "content": data.get("text", "")})
        elif etype == "message_start":
            mid = data.get("id")
            open_text[mid] = len(messages)
            messages.append({"role": "assistant", "content": ""})
        elif etype == "message_delta":
            mid = data.get("id")
            idx = open_text.get(mid)
            if idx is not None:
                messages[idx]["content"] += data.get("delta", "")
        elif etype == "message_end":
            open_text.pop(data.get("id"), None)
        elif etype == "tool_call":
            messages.append(
                {
                    "role": "tool",
                    "content": "",
                    "tool_call_id": data.get("id"),
                    "tool_name": data.get("name"),
                    "input": data.get("input"),
                }
            )
        elif etype == "tool_result":
            messages.append(
                {
                    "role": "tool",
                    "content": data.get("output", ""),
                    "tool_call_id": data.get("id"),
                    "is_error": data.get("isError"),
                }
            )
        elif etype == "interaction_request":
            last_interaction_request = data
        elif etype == "done":
            event_stop_reason = data.get("stopReason")
        # thought_start/thought_delta/thought_end, data, file, usage, error: no message.

    resolved_stop = stop_reason if stop_reason is not None else event_stop_reason
    pending_interaction: Optional[Dict[str, Any]] = None
    if resolved_stop == "paused" and last_interaction_request is not None:
        # Superset of the raw interaction_request data plus the derived `tool` name, so
        # headless callers can act on `{id, tool}` without parsing the ACP payload.
        pending_interaction = dict(last_interaction_request)
        pending_interaction.setdefault(
            "tool", _pending_tool_name(last_interaction_request)
        )

    return {
        "messages": messages,
        "stop_reason": resolved_stop,
        "pending_interaction": pending_interaction,
    }


def _is_trailing_tool_unit(message: Message) -> bool:
    return message.get("role") == "tool"


def trim_to_trailing_unit(messages: List[Message]) -> List[Message]:
    """Trailing unit of a folded turn: last text message, or the trailing tool run + its opener."""
    if not messages:
        return []

    last = messages[-1]
    if not _is_trailing_tool_unit(last):
        return [last]

    # Walk back over the trailing tool run, plus its initiating assistant message.
    end = len(messages)
    start = end - 1
    while start > 0 and _is_trailing_tool_unit(messages[start - 1]):
        start -= 1
    if start > 0:
        start -= 1  # include the initiating assistant message
    return messages[start:end]
