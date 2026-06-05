"""Stream an OpenAI Agents SDK run as a Vercel AI SDK v1 UI Message Stream.

This is the OpenAI Agents SDK counterpart to the Pydantic-AI streamer in
``server/main.py``. It emits the *same* SSE envelope so the frontend renders
both runtimes identically:

    start -> start-step -> (text-* / tool-*)... -> text-end -> finish-step
          -> finish -> [DONE]

The mapping from ``Runner.run_streamed(...).stream_events()``:

    RawResponsesStreamEvent(ResponseTextDeltaEvent)  -> text-start / text-delta
    RunItemStreamEvent(name="tool_called")           -> tool-input-available
    RunItemStreamEvent(name="tool_output")           -> tool-output-available

Conversation memory is kept in-process keyed by the chat id the Vercel
``useChat`` hook sends, exactly like the Pydantic-AI path. The two stores are
separate because the item shapes differ (Agents SDK input items vs Pydantic-AI
``ModelMessage``); the frontend resets the conversation when the runtime
changes, so they never need to interoperate.
"""

from __future__ import annotations

import json
import uuid
from typing import Any, AsyncIterator, Optional

from agents import Agent, Runner
from agents.stream_events import RawResponsesStreamEvent, RunItemStreamEvent
from openai.types.responses import ResponseTextDeltaEvent

from core.deps import AgentDeps


# chat_id -> list of Agents SDK input items (the running conversation).
_HISTORIES: dict[str, list[Any]] = {}


def _sse(obj: dict[str, Any]) -> str:
    return f"data: {json.dumps(obj, default=str)}\n\n"


def _parse_json(value: Any) -> Any:
    """Best-effort: tool args/outputs are JSON strings; fall back to raw."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


async def stream_run(
    agent: Agent[AgentDeps],
    user_msg: str,
    chat_id: Optional[str],
    deps: AgentDeps,
) -> AsyncIterator[str]:
    message_id = f"msg_{uuid.uuid4().hex[:12]}"

    history = _HISTORIES.get(chat_id, []) if chat_id else []
    run_input: Any = [*history, {"role": "user", "content": user_msg}]

    yield _sse({"type": "start", "messageId": message_id})
    yield _sse({"type": "start-step"})

    text_id: Optional[str] = None

    def _open_text() -> list[str]:
        nonlocal text_id
        if text_id is None:
            text_id = f"text_{uuid.uuid4().hex[:12]}"
            return [_sse({"type": "text-start", "id": text_id})]
        return []

    def _close_text() -> list[str]:
        nonlocal text_id
        if text_id is not None:
            out = [_sse({"type": "text-end", "id": text_id})]
            text_id = None
            return out
        return []

    try:
        result = Runner.run_streamed(agent, input=run_input, context=deps)

        async for event in result.stream_events():
            if isinstance(event, RawResponsesStreamEvent):
                data = event.data
                if isinstance(data, ResponseTextDeltaEvent) and data.delta:
                    for chunk in _open_text():
                        yield chunk
                    yield _sse({"type": "text-delta", "id": text_id, "delta": data.delta})

            elif isinstance(event, RunItemStreamEvent):
                if event.name == "tool_called":
                    for chunk in _close_text():
                        yield chunk
                    item = event.item
                    yield _sse(
                        {
                            "type": "tool-input-available",
                            "toolCallId": item.call_id,
                            "toolName": item.tool_name,
                            "input": _parse_json(getattr(item.raw_item, "arguments", None)),
                        }
                    )
                elif event.name == "tool_output":
                    item = event.item
                    yield _sse(
                        {
                            "type": "tool-output-available",
                            "toolCallId": item.call_id,
                            "output": _parse_json(item.output),
                        }
                    )

        if chat_id:
            _HISTORIES[chat_id] = result.to_input_list()

    except Exception as e:  # noqa: BLE001
        yield _sse({"type": "error", "errorText": str(e)})

    for chunk in _close_text():
        yield chunk

    yield _sse({"type": "finish-step"})
    yield _sse({"type": "finish"})
    yield "data: [DONE]\n\n"
