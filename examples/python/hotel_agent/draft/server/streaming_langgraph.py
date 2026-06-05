"""LangChain runtime -> Vercel AI SDK v1 UI Message Stream.

The Pydantic-AI runtime has its own translator in ``main.py``. This module is
the LangChain equivalent: it drives ``agent.astream`` and maps LangGraph's
event stream to the same Vercel events ``main.py`` emits, so the frontend
renders both runtimes identically.

LangGraph multi-mode streaming (``stream_mode=["updates", "messages"]``) yields
``(mode, payload)`` tuples:

    ("messages", (chunk, metadata))   token deltas, chunk-by-chunk
    ("updates", {node: {"messages": [...]}})   completed messages per graph step

Mapping:

    AIMessageChunk text (messages mode)        -> text-start / text-delta / text-end
    AIMessage.tool_calls (updates mode)        -> tool-input-available
    ToolMessage (updates mode)                 -> tool-output-available

Text comes from "messages" mode (streamed); tool calls and results come from
"updates" mode (complete, with stable ids). We never read text from "updates"
to avoid double-emitting.

History: kept in-process in a chat_id -> [BaseMessage] dict, mirroring the
Pydantic-AI path. Only human/assistant/tool turns are stored; the system
message (with fresh grounding) is rebuilt every turn.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, AsyncIterator, Optional

from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    ToolMessage,
)

from core.deps import AgentDeps


# Conversation memory keyed by the chat id Vercel useChat sends. Separate from
# the Pydantic-AI history dict — different message types.
_LG_HISTORIES: dict[str, list[BaseMessage]] = {}


def _sse(obj: dict[str, Any]) -> str:
    return f"data: {json.dumps(obj, default=str)}\n\n"


def _text_of(content: Any) -> str:
    """Extract plain text from a message's ``content`` (str or content blocks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        return "".join(parts)
    return ""


def _parse_output(content: Any) -> Any:
    """Tool adapters return JSON strings; re-parse for structured UI output."""
    if isinstance(content, str):
        try:
            return json.loads(content)
        except (ValueError, TypeError):
            return content
    return content


async def stream_langgraph(
    runtime: str,  # noqa: ARG001 — kept for a uniform streamer signature
    user_msg: str,
    chat_id: Optional[str],
    deps: AgentDeps,
) -> AsyncIterator[str]:
    """Drive the LangChain agent and translate its stream to Vercel AI SDK v1."""
    # Imported lazily so the server still boots if LangChain isn't installed.
    from runtimes.langgraph.vanilla import agent, build_input_messages

    message_id = f"msg_{uuid.uuid4().hex[:12]}"
    history = _LG_HISTORIES.get(chat_id, []) if chat_id else []
    messages = await build_input_messages(deps, history, user_msg)

    yield _sse({"type": "start", "messageId": message_id})
    yield _sse({"type": "start-step"})

    text_id: Optional[str] = None
    new_messages: list[BaseMessage] = []

    def _close_text() -> Optional[str]:
        nonlocal text_id
        if text_id is not None:
            chunk = _sse({"type": "text-end", "id": text_id})
            text_id = None
            return chunk
        return None

    try:
        async for mode, payload in agent.astream(
            {"messages": messages},
            context=deps,
            stream_mode=["updates", "messages"],
        ):
            if mode == "messages":
                msg, _meta = payload
                if isinstance(msg, (AIMessage, AIMessageChunk)):
                    text = _text_of(msg.content)
                    if text:
                        if text_id is None:
                            text_id = f"text_{uuid.uuid4().hex[:12]}"
                            yield _sse({"type": "text-start", "id": text_id})
                        yield _sse({"type": "text-delta", "id": text_id, "delta": text})

            elif mode == "updates":
                for _node, update in (payload or {}).items():
                    if not isinstance(update, dict):
                        continue
                    for m in update.get("messages", []):
                        new_messages.append(m)
                        if isinstance(m, AIMessage) and m.tool_calls:
                            closed = _close_text()
                            if closed:
                                yield closed
                            for tc in m.tool_calls:
                                yield _sse(
                                    {
                                        "type": "tool-input-available",
                                        "toolCallId": tc.get("id"),
                                        "toolName": tc.get("name"),
                                        "input": tc.get("args"),
                                    }
                                )
                        elif isinstance(m, ToolMessage):
                            yield _sse(
                                {
                                    "type": "tool-output-available",
                                    "toolCallId": m.tool_call_id,
                                    "output": _parse_output(m.content),
                                }
                            )
    except asyncio.CancelledError:
        raise
    except Exception as e:  # noqa: BLE001
        yield _sse({"type": "error", "errorText": str(e)})

    closed = _close_text()
    if closed:
        yield closed

    if chat_id:
        _LG_HISTORIES[chat_id] = [*history, HumanMessage(content=user_msg), *new_messages]

    yield _sse({"type": "finish-step"})
    yield _sse({"type": "finish"})
    yield "data: [DONE]\n\n"
