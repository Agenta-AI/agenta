"""FastAPI server — exposes every runtime via ``POST /api/chat/{runtime}``.

Stream protocol: Vercel AI SDK v1 UI Message Stream (header
``x-vercel-ai-ui-message-stream: v1``). Each chunk is a single ``data: <json>``
SSE event. The mapping from Pydantic-AI's event stream to Vercel events:

    PartStartEvent(TextPart)         -> text-start (new id)
    PartDeltaEvent(TextPartDelta)    -> text-delta (same id)
    (next part / end)                -> text-end
    FunctionToolCallEvent            -> tool-input-available
    FunctionToolResultEvent          -> tool-output-available  (or tool-output-error)

History: kept in-process in a chat_id -> [ModelMessage] dict. Good enough for
a demo; no DB.

Run:

    cd examples/python/hotel_agent/draft
    uv run uvicorn server.main:app --reload --port 8000
"""

from __future__ import annotations

import json
import uuid
from contextlib import asynccontextmanager
from dataclasses import replace
from typing import Any, AsyncIterator, Optional

import agenta as ag
import logfire
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, model_validator
from pydantic_ai import Agent, RunContext
from pydantic_ai.agent import InstrumentationSettings
from pydantic_ai.messages import (
    AgentStreamEvent,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ModelMessage,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    ToolCallPart,
)

from core.container import build_default_deps
from core.deps import AgentDeps

from server.config import settings
from server.openai_agents_stream import stream_run as stream_openai_agents
from server.runtimes import RUNTIMES, get_agent, get_spec, list_runtimes
from server.streaming_langgraph import stream_langgraph


# --- Lifecycle ----------------------------------------------------------------


# Process-scoped baseline deps. Cloned per-request with a different
# current_user_id (frozen dataclass -> dataclasses.replace).
_BASE_DEPS: Optional[AgentDeps] = None

# Conversation memory keyed by the chat id Vercel useChat sends.
_HISTORIES: dict[str, list[ModelMessage]] = {}


# Instrumentation is wired once at startup and covers *all* runtimes, since the
# runtime is chosen per request. Each framework gets its own OTel bridge:
# PydanticAI via InstrumentationSettings, the OpenAI Agents SDK and LangChain /
# LangGraph via OpenInference.
from openinference.instrumentation.langchain import LangChainInstrumentor  # noqa: E402
from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor  # noqa: E402

if settings.TRACING_BACKEND == "logfire":
    logfire.configure(
        service_name="hotel-agent",
        send_to_logfire=True,
        token=settings.LOGFIRE_TOKEN,
        scrubbing=False,
    )
    logfire.instrument_pydantic_ai()
    # logfire.configure() sets the global OTel provider; OpenInference picks it up.
    OpenAIAgentsInstrumentor().instrument()
    LangChainInstrumentor().instrument()
else:
    # Agenta: ag.init() installs a global OpenTelemetry TracerProvider that
    # exports OTLP to the Agenta host. Point each framework's instrumentation at
    # that provider so every agent run emits spans to Agenta.
    #
    # We deliberately do NOT configure logfire here. PydanticAI's default
    # instrumentation prefers logfire as its span sink; with send_to_logfire
    # off, spans would be silently dropped instead of reaching Agenta. Passing
    # an explicit tracer_provider routes spans straight to Agenta's exporter.
    from opentelemetry import trace as _otel_trace

    ag.init(api_key=settings.AGENTA_API_KEY, host=settings.AGENTA_HOST)
    _provider = _otel_trace.get_tracer_provider()
    Agent.instrument_all(InstrumentationSettings(tracer_provider=_provider))
    # OpenInference auto-captures the OpenAI Agents SDK (agents, tools, LLM
    # calls) and exports OpenInference-convention spans to Agenta's provider.
    OpenAIAgentsInstrumentor().instrument(tracer_provider=_provider)
    # Same bridge for LangChain / LangGraph (covers the create_agent graph,
    # tool nodes, and chat-model calls).
    LangChainInstrumentor().instrument(tracer_provider=_provider)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    global _BASE_DEPS
    _BASE_DEPS = await build_default_deps(
        db_url=settings.DB_URL,
        current_user_id=settings.DEFAULT_PERSONA,
    )
    yield


app = FastAPI(
    title="Hotel Agent API",
    description="Multi-runtime hotel concierge agent",
    version="0.1.0",
    lifespan=_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN, "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Request model ------------------------------------------------------------


class ChatMessage(BaseModel):
    role: str
    content: Optional[str] = None
    parts: Optional[list[dict[str, Any]]] = None

    @model_validator(mode="after")
    def _resolve_text(self) -> "ChatMessage":
        if self.content is None and self.parts:
            texts = [p.get("text", "") for p in self.parts if p.get("type") == "text"]
            self.content = " ".join(t for t in texts if t)
        return self

    def text(self) -> str:
        return self.content or ""


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    id: Optional[str] = None
    current_user_id: Optional[str] = None

    model_config = {"extra": "ignore"}


# --- Health / discovery -------------------------------------------------------


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "healthy"}


@app.get("/api/runtimes")
async def runtimes() -> dict[str, list[str]]:
    return {"runtimes": list_runtimes()}


# --- SSE helpers --------------------------------------------------------------


def _sse(obj: dict[str, Any]) -> str:
    return f"data: {json.dumps(obj, default=str)}\n\n"


def _serializable(value: Any) -> Any:
    """Make pydantic-ai tool args/outputs JSON-serializable."""
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, list):
        return [_serializable(v) for v in value]
    if isinstance(value, dict):
        return {k: _serializable(v) for k, v in value.items()}
    return value


# --- Streaming ----------------------------------------------------------------


async def _stream_run(
    runtime: str,
    user_msg: str,
    chat_id: Optional[str],
    deps: AgentDeps,
) -> AsyncIterator[str]:
    """Drive the agent and translate its event stream to Vercel AI SDK v1.

    Pydantic-AI calls our ``event_stream_handler`` inside ``agent.run()``. To
    interleave its emissions with our outer SSE generator we run the agent as
    a background task and pipe events through an ``asyncio.Queue``.
    """
    import asyncio

    agent = get_agent(runtime)
    message_id = f"msg_{uuid.uuid4().hex[:12]}"
    history = _HISTORIES.get(chat_id, []) if chat_id else []

    yield _sse({"type": "start", "messageId": message_id})
    yield _sse({"type": "start-step"})

    # Track the active text part id so deltas/end correlate.
    text_id: Optional[str] = None
    queue: asyncio.Queue = asyncio.Queue()
    SENTINEL = object()

    def _translate(event: AgentStreamEvent) -> list[str]:
        nonlocal text_id
        out: list[str] = []
        if isinstance(event, PartStartEvent):
            if isinstance(event.part, TextPart):
                if text_id is not None:
                    out.append(_sse({"type": "text-end", "id": text_id}))
                text_id = f"text_{uuid.uuid4().hex[:12]}"
                out.append(_sse({"type": "text-start", "id": text_id}))
                if event.part.content:
                    out.append(
                        _sse({"type": "text-delta", "id": text_id, "delta": event.part.content})
                    )
            elif isinstance(event.part, ToolCallPart):
                # Defer to FunctionToolCallEvent, which has resolved args.
                pass
        elif isinstance(event, PartDeltaEvent):
            if isinstance(event.delta, TextPartDelta):
                if text_id is None:
                    text_id = f"text_{uuid.uuid4().hex[:12]}"
                    out.append(_sse({"type": "text-start", "id": text_id}))
                if event.delta.content_delta:
                    out.append(
                        _sse(
                            {
                                "type": "text-delta",
                                "id": text_id,
                                "delta": event.delta.content_delta,
                            }
                        )
                    )
        elif isinstance(event, FunctionToolCallEvent):
            out.append(
                _sse(
                    {
                        "type": "tool-input-available",
                        "toolCallId": event.part.tool_call_id,
                        "toolName": event.part.tool_name,
                        "input": _serializable(event.part.args),
                    }
                )
            )
        elif isinstance(event, FunctionToolResultEvent):
            try:
                output = _serializable(event.result.content)
                json.dumps(output, default=str)
                out.append(
                    _sse(
                        {
                            "type": "tool-output-available",
                            "toolCallId": event.tool_call_id,
                            "output": output,
                        }
                    )
                )
            except Exception as e:  # noqa: BLE001
                out.append(
                    _sse(
                        {
                            "type": "tool-output-error",
                            "toolCallId": event.tool_call_id,
                            "errorText": str(e),
                        }
                    )
                )
        return out

    async def handler(_ctx: RunContext, events) -> None:
        async for event in events:
            for chunk in _translate(event):
                await queue.put(chunk)

    async def run_agent() -> None:
        try:
            result = await agent.run(
                user_msg,
                deps=deps,
                message_history=history,
                event_stream_handler=handler,
            )
            if chat_id:
                _HISTORIES[chat_id] = list(result.all_messages())
        except Exception as e:  # noqa: BLE001
            await queue.put(_sse({"type": "error", "errorText": str(e)}))
        finally:
            await queue.put(SENTINEL)

    task = asyncio.create_task(run_agent())

    while True:
        chunk = await queue.get()
        if chunk is SENTINEL:
            break
        yield chunk

    await task

    if text_id is not None:
        yield _sse({"type": "text-end", "id": text_id})

    yield _sse({"type": "finish-step"})
    yield _sse({"type": "finish"})
    yield "data: [DONE]\n\n"


# --- Routes -------------------------------------------------------------------


@app.post("/api/chat/{runtime}")
async def chat(runtime: str, request: ChatRequest) -> StreamingResponse:
    if runtime not in RUNTIMES:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown runtime {runtime!r}. Try one of: {list_runtimes()}",
        )
    if _BASE_DEPS is None:
        raise HTTPException(status_code=503, detail="Server still starting up")

    user_messages = [m for m in request.messages if m.role == "user"]
    if not user_messages:
        raise HTTPException(status_code=400, detail="No user message in request")

    user_msg = user_messages[-1].text()
    persona = request.current_user_id or settings.DEFAULT_PERSONA
    deps = replace(_BASE_DEPS, current_user_id=persona)

    # Pick the streamer for this runtime's framework. Each translates to the same
    # Vercel AI SDK v1 envelope, so the frontend handles them identically.
    kind = get_spec(runtime).kind
    if kind == "openai_agents":
        generator = stream_openai_agents(get_agent(runtime), user_msg, request.id, deps)
    elif kind == "langgraph":
        generator = stream_langgraph(runtime, user_msg, request.id, deps)
    else:
        generator = _stream_run(runtime, user_msg, request.id, deps)

    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "x-vercel-ai-ui-message-stream": "v1",
            "cache-control": "no-cache",
            "x-accel-buffering": "no",
        },
    )
