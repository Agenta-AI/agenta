"""The result file of one ended child turn (design D8).

The producer writes it into the calling session's working folder at
`child-sessions/<child session id>/turn-<turn index>.md`. It covers every execution of
the turn, from the first through each approval continuation, in order. It holds content
that the child read, so it is data for the calling agent, like a child update.
"""

import json
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from agenta.sdk.agents.fold import fold

from oss.src.core.channels.render.render import extract_final_answer
from oss.src.core.sessions.records.dtos import SessionRecord
from oss.src.core.shared.dtos import RunUsage

RESULT_FILE_FOLDER = "child-sessions"
# The writer stops writing steps when the file reaches this size.
RESULT_FILE_MAX_BYTES = 1024 * 1024
STEP_INPUT_MAX_BYTES = 4 * 1024
STEP_OUTPUT_MAX_BYTES = 16 * 1024

_RECORD_SOURCE_AGENT = "agent"


def result_file_path(*, child_session_id: str, turn_index: int) -> str:
    """Relative to the calling session's working folder. The index is the stored
    `turn_index`, which starts at 0, with no offset."""
    return f"{RESULT_FILE_FOLDER}/{child_session_id}/turn-{turn_index}.md"


def _cut_bytes(text: str, limit: int) -> str:
    raw = text.encode("utf-8")
    if len(raw) <= limit:
        return text
    cut = raw[:limit].decode("utf-8", errors="ignore")
    return f"{cut}\n[cut at {limit // 1024} KB]"


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False, indent=2)
    except (TypeError, ValueError):
        return str(value)


# The answer of an approval step. The approved line is the one D8 gives.
_NOT_ANSWERED = "not_answered"


def _approval_answer(answer: Any) -> str:
    if answer is True:
        return "<approved by a person>"
    if answer is False:
        return "<rejected by a person>"
    if answer == _NOT_ANSWERED:
        return "<no answer>"
    return "<answered by a person>"


def turn_messages(execution_records: Sequence[Sequence[SessionRecord]]) -> List[Dict]:
    """The folded messages of every execution of the turn, in order. An execution that
    paused adds one approval step for its pending interaction."""
    # True or False for an approval answer, None for an answer with no `approved`.
    answers: Dict[str, Any] = {}
    for records in execution_records:
        for record in records:
            if record.record_type != "interaction_response":
                continue
            attributes = record.attributes or {}
            payload = attributes.get("payload")
            payload = payload if isinstance(payload, dict) else {}
            approved = payload.get("approved")
            if attributes.get("id"):
                # A request that the platform cancelled (a Stop or a kill) has no
                # answer from a person.
                answers[str(attributes["id"])] = (
                    _NOT_ANSWERED
                    if payload.get("outcome") == "cancelled"
                    else approved
                    if isinstance(approved, bool)
                    else None
                )

    messages: List[Dict] = []
    for records in execution_records:
        folded = fold(
            [
                {"type": record.record_type, "data": record.attributes}
                for record in records
                if record.record_source == _RECORD_SOURCE_AGENT
            ]
        )
        messages.extend(folded.get("messages") or [])
        pending = folded.get("pending_interaction")
        if pending:
            messages.append(
                {
                    "role": "approval",
                    "tool_name": pending.get("tool"),
                    "answer": answers.get(str(pending.get("id")), _NOT_ANSWERED),
                }
            )
    return messages


def last_message(messages: List[Dict]) -> str:
    """The reply of the turn: what the agent said after its last tool."""
    return extract_final_answer(
        [message for message in messages if message.get("role") != "approval"]
    )


def _steps(messages: List[Dict]) -> List[str]:
    """One Markdown block per step. A tool call and its result are one step."""
    steps: List[str] = []
    tool_steps: Dict[Any, int] = {}
    tool_parts: Dict[int, Dict[str, Any]] = {}
    for message in messages:
        role = message.get("role")
        if role == "assistant":
            text = message.get("content")
            if isinstance(text, str) and text.strip():
                steps.append(f"### Assistant\n{text}")
        elif role == "approval":
            steps.append(
                f"### Approval: {message.get('tool_name') or 'tool'}\n"
                f"{_approval_answer(message.get('answer'))}"
            )
        elif role == "tool":
            call_id = message.get("tool_call_id")
            index = tool_steps.get(call_id) if call_id is not None else None
            if index is None:
                index = len(steps)
                steps.append("")
                tool_parts[index] = {"name": message.get("tool_name"), "output": None}
                if call_id is not None:
                    tool_steps[call_id] = index
            parts = tool_parts[index]
            if "input" in message:
                parts["input"] = message.get("input")
                if message.get("tool_name"):
                    parts["name"] = parts["name"] or message.get("tool_name")
            else:
                parts["output"] = message.get("content")
            steps[index] = _tool_step(parts)
    return steps


def _tool_step(parts: Dict[str, Any]) -> str:
    lines = [f"### Tool call: {parts.get('name') or 'tool'}", "Input:"]
    lines.append(_cut_bytes(_as_text(parts.get("input")), STEP_INPUT_MAX_BYTES))
    lines.append("Output:")
    lines.append(_cut_bytes(_as_text(parts.get("output")), STEP_OUTPUT_MAX_BYTES))
    return "\n".join(lines)


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat().replace("+00:00", "Z") if value else None


def _omitted(count: int) -> str:
    return f"{count} more steps; read them with read_session\n"


def render_result_file(
    *,
    title: str,
    turn_index: int,
    child_session_id: str,
    status: str,
    sent: Optional[str],
    messages: List[Dict],
    started: Optional[datetime] = None,
    ended: Optional[datetime] = None,
    usage: Optional[RunUsage] = None,
    trace_id: Optional[str] = None,
    max_bytes: int = RESULT_FILE_MAX_BYTES,
) -> str:
    """The file text. Each step is cut as D8 says. When the file reaches `max_bytes`,
    the writer stops writing steps and writes one line that says how many are left.
    `## Last message` is always complete."""
    header = [f"# {title}, turn {turn_index}", f"- session: {child_session_id}"]
    header.append(f"- status: {status}")
    if _iso(started):
        header.append(f"- started: {_iso(started)}")
    if _iso(ended):
        header.append(f"- ended: {_iso(ended)}")
    if usage is not None and (
        usage.input_tokens is not None or usage.output_tokens is not None
    ):
        counts = [
            f"{count} {label}"
            for count, label in (
                (usage.input_tokens, "in"),
                (usage.output_tokens, "out"),
            )
            if count is not None
        ]
        header.append(f"- tokens: {', '.join(counts)}")
    if trace_id:
        header.append(f"- trace: {trace_id}")

    head = "\n".join(header) + "\n\n## Sent\n" + (sent or "") + "\n\n## Steps\n"
    tail = "\n## Last message\n" + last_message(messages) + "\n"

    budget = max_bytes - len(head.encode("utf-8")) - len(tail.encode("utf-8"))
    steps = _steps(messages)
    written: List[str] = []
    used = 0
    for index, step in enumerate(steps):
        block = step + "\n\n"
        size = len(block.encode("utf-8"))
        # Keep room for the notice while more steps follow, so it always fits.
        left = len(steps) - index - 1
        notice = len(_omitted(left).encode("utf-8")) if left else 0
        if used + size + notice > budget:
            omitted = _omitted(len(steps) - index)
            if used + len(omitted.encode("utf-8")) <= budget:
                written.append(omitted)
            break
        written.append(block)
        used += size
    return head + "".join(written) + tail
