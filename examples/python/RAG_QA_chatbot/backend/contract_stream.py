"""Agent chat slice endpoints (contract v1) — real agent loop, with a mock fallback.

These two endpoints serve the **v6 UI Message Stream protocol** the frontend `useChat`
hook consumes. There are two execution modes behind the same wire contract:

  * **Real** (default once creds exist) — a genuine LLM function-calling loop in
    `agent_loop.py`: real `search_docs` retrieval (Qdrant), a real approval-gated
    `send_summary_email`, real streamed tokens, and a real Agenta trace id.
  * **Mock** (credential-free fallback) — the canned generators below, which emit the
    identical part lifecycle with NO dependency on litellm / qdrant / agenta, so the
    streaming contract can still be exercised end to end without any credentials.

Mode is chosen by `_real_enabled()` (env `AGENT_CHAT_MODE=auto|real|mock`). When real is
active the heavy deps are imported lazily, so `contract_main.py` stays self-contained.

The mock mirrors the full part lifecycle the real agent loop emits:

    start
      → reasoning-start / -delta / -end
      → text-start / -delta / -end
      → source-url (x2)
      → tool-input-start / -input-available / -output-available   (auto tool, no approval)
      → tool-input-start / -input-available / -approval-request    (tool that needs approval)
      → data-trace
      → finish

On the follow-up request (after the user approves/denies via
`addToolApprovalResponse`), the FE re-POSTs the full history with the tool part in
`approval-responded` state. We detect it and resume:

    start
      → tool-output-available | tool-output-denied   (per the user's decision)
      → text-start / -delta / -end
      → data-trace
      → finish

Wire framing: SSE, each event `data: <json>\\n\\n`, terminated by `data: [DONE]\\n\\n`,
response header `x-vercel-ai-ui-message-stream: v1`.

Two request contracts share this identical response stream so the team can compare them:

  * **Track A** — `POST /api/agent/chat`. Request `messages` is the AI SDK `UIMessage[]`
    shape (`{role, parts: [...]}`). The FE sends what `useChat` produces verbatim; the
    approval decision rides inside the assistant message's tool part
    (`state: "approval-responded"`). Zero FE translation; the service must speak parts.

  * **Track B** — `POST /api/agent/chat-agenta`. Request `messages` is the existing Agenta
    `{role, content}` shape (OpenAI/ACP-style, same as `chat.py`/`completion.py`), with
    tool calls as `tool_calls`/`tool` messages. Because the Agenta message contract has no
    slot for an approval decision, Track B carries it in a `tool_approvals` side field.
    This is the "FE adapts down to the uniform backend contract" option — it costs a FE
    translation layer (`toAgentaMessage`) and a net-new approval encoding.

The *response* is byte-for-byte identical between the two — only how the FE encodes the
request (and how this mock reads it) differs.
"""

import asyncio
import json
import os
import uuid
from typing import Any, AsyncGenerator, Dict, List

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

router = APIRouter()

# Where the trace link points. Only the trailing path segment (the trace id) is
# meaningful to the FE — it parses it out and feeds it to `openTraceDrawerAtom`.
AGENTA_HOST = os.getenv("AGENTA_HOST", "https://cloud.agenta.ai")

# Delay between streamed deltas so the stream is visibly incremental in the UI.
DELTA_DELAY_S = float(os.getenv("CONTRACT_DELTA_DELAY", "0.04"))


def _sse(obj: Dict[str, Any]) -> str:
    return f"data: {json.dumps(obj)}\n\n"


def _new_trace_id() -> str:
    """A 32-char hex string shaped like an OTel trace id."""
    return uuid.uuid4().hex + uuid.uuid4().hex[:0]  # 32 hex chars


def _trace_event() -> Dict[str, Any]:
    trace_id = _new_trace_id()
    return {
        "type": "data-trace",
        "data": {
            "traceId": trace_id,
            "url": f"{AGENTA_HOST}/observability/traces/{trace_id}",
        },
    }


def _last_user_text(messages: List[Dict[str, Any]]) -> str:
    """Last user text. Tolerates both the UIMessage (`parts`) and Agenta (`content`)
    message shapes, so it serves both tracks."""
    for msg in reversed(messages):
        if msg.get("role") != "user":
            continue
        content = msg.get("content")
        if isinstance(content, str) and content:
            return content
        if isinstance(content, list):  # ACP ContentBlock[]
            texts = [b.get("text", "") for b in content if b.get("type") == "text"]
            if texts:
                return " ".join(t for t in texts if t)
        parts = msg.get("parts") or []
        texts = [p.get("text", "") for p in parts if p.get("type") == "text"]
        if texts:
            return " ".join(t for t in texts if t)
    return ""


# ---- Track A: approvals read from UIMessage tool parts ---------------------------------


def _pending_approvals_uimessage(
    messages: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Tool parts the user has just approved/denied but that have no output yet.

    Track A: the FE encodes the decision on the assistant message's tool part as
    `state == "approval-responded"` with `approval: {id, approved}`.
    """
    pending: List[Dict[str, Any]] = []
    for msg in messages:
        if msg.get("role") != "assistant":
            continue
        for part in msg.get("parts") or []:
            ptype = part.get("type", "")
            if not ptype.startswith("tool-"):
                continue
            if part.get("state") != "approval-responded":
                continue
            approval = part.get("approval") or {}
            pending.append(
                {
                    "toolCallId": part.get("toolCallId"),
                    "toolName": ptype[len("tool-") :],
                    "input": part.get("input"),
                    "approved": bool(approval.get("approved")),
                }
            )
    return pending


# ---- Track B: approvals read from the `tool_approvals` side channel --------------------


def _pending_approvals_agenta(body: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Track B: the Agenta `{role, content}` message contract has no slot for an approval
    decision, so the FE adapter surfaces it in a top-level `tool_approvals` field:

        "tool_approvals": [ { "tool_call_id": "call_x", "approved": true } ]

    An entry is "pending" only while the matching tool call has no `tool` result message
    yet — the same window Track A detects via `state == "approval-responded"`.
    """
    approvals = body.get("tool_approvals") or []
    if not approvals:
        return []

    # tool_call_ids that already have a result (so they are no longer pending)
    resolved: set = set()
    for msg in body.get("messages") or []:
        if msg.get("role") == "tool" and msg.get("tool_call_id"):
            resolved.add(msg["tool_call_id"])

    pending: List[Dict[str, Any]] = []
    for entry in approvals:
        tool_call_id = entry.get("tool_call_id")
        if not tool_call_id or tool_call_id in resolved:
            continue
        pending.append(
            {
                "toolCallId": tool_call_id,
                "toolName": entry.get("tool_name", "tool"),
                "input": entry.get("input"),
                "approved": bool(entry.get("approved")),
            }
        )
    return pending


async def _emit_text(text: str, *, prefix: str = "") -> AsyncGenerator[str, None]:
    """Stream `text` as text-start/-delta(word-chunked)/-end."""
    text_id = str(uuid.uuid4())
    yield _sse({"type": "text-start", "id": text_id})
    if prefix:
        yield _sse({"type": "text-delta", "id": text_id, "delta": prefix})
    for token in _tokenize(text):
        yield _sse({"type": "text-delta", "id": text_id, "delta": token})
        await asyncio.sleep(DELTA_DELAY_S)
    yield _sse({"type": "text-end", "id": text_id})


async def _emit_reasoning(text: str) -> AsyncGenerator[str, None]:
    reasoning_id = str(uuid.uuid4())
    yield _sse({"type": "reasoning-start", "id": reasoning_id})
    for token in _tokenize(text):
        yield _sse({"type": "reasoning-delta", "id": reasoning_id, "delta": token})
        await asyncio.sleep(DELTA_DELAY_S)
    yield _sse({"type": "reasoning-end", "id": reasoning_id})


def _tokenize(text: str) -> List[str]:
    """Split into whitespace-preserving chunks so deltas concatenate cleanly."""
    out: List[str] = []
    word = ""
    for ch in text:
        word += ch
        if ch == " ":
            out.append(word)
            word = ""
    if word:
        out.append(word)
    return out


async def _initial_turn(query: str) -> AsyncGenerator[str, None]:
    message_id = str(uuid.uuid4())
    yield _sse({"type": "start", "messageId": message_id})

    # 1) reasoning (v6 reasoning parts)
    async for ev in _emit_reasoning(
        "The user is asking about the documentation. I'll search the docs, then "
        "draft a follow-up email and ask for approval before sending it."
    ):
        yield ev

    # 2) answer text
    async for ev in _emit_text(
        f'Here is what I found about "{query.strip() or "your question"}". '
        "Agenta lets you version prompts, run evaluations, and trace every call. "
        "I pulled the most relevant sections from the docs below."
    ):
        yield ev

    # 3) sources
    for url in (
        "https://docs.agenta.ai/prompt-management/overview",
        "https://docs.agenta.ai/observability/quickstart",
    ):
        yield _sse({"type": "source-url", "sourceId": url, "url": url, "title": url})
    await asyncio.sleep(DELTA_DELAY_S)

    # 4) auto tool — full input→output lifecycle, no approval needed
    search_id = f"call_{uuid.uuid4().hex[:12]}"
    yield _sse(
        {"type": "tool-input-start", "toolCallId": search_id, "toolName": "search_docs"}
    )
    yield _sse(
        {
            "type": "tool-input-available",
            "toolCallId": search_id,
            "toolName": "search_docs",
            "input": {"query": query.strip() or "agenta overview", "top_k": 3},
        }
    )
    await asyncio.sleep(DELTA_DELAY_S * 4)
    yield _sse(
        {
            "type": "tool-output-available",
            "toolCallId": search_id,
            "output": {
                "hits": [
                    {"title": "Prompt Management", "score": 0.94},
                    {"title": "Observability Quickstart", "score": 0.89},
                    {"title": "Evaluations", "score": 0.81},
                ]
            },
        }
    )

    # 5) approval tool — input available, then halt for human approval
    email_id = f"call_{uuid.uuid4().hex[:12]}"
    approval_id = f"approval_{uuid.uuid4().hex[:12]}"
    yield _sse(
        {
            "type": "tool-input-start",
            "toolCallId": email_id,
            "toolName": "send_summary_email",
        }
    )
    yield _sse(
        {
            "type": "tool-input-available",
            "toolCallId": email_id,
            "toolName": "send_summary_email",
            "input": {
                "to": "team@example.com",
                "subject": "Docs summary",
                "body": "Sharing the relevant Agenta docs sections from our chat.",
            },
        }
    )
    await asyncio.sleep(DELTA_DELAY_S * 2)
    yield _sse(
        {
            "type": "tool-approval-request",
            "approvalId": approval_id,
            "toolCallId": email_id,
        }
    )

    # 6) trace + finish (the turn completes with the email tool awaiting approval)
    yield _sse(_trace_event())
    yield _sse({"type": "finish"})
    yield "data: [DONE]\n\n"


async def _resume_turn(pending: List[Dict[str, Any]]) -> AsyncGenerator[str, None]:
    message_id = str(uuid.uuid4())
    yield _sse({"type": "start", "messageId": message_id})

    any_approved = False
    any_denied = False
    for tool in pending:
        await asyncio.sleep(DELTA_DELAY_S * 2)
        if tool["approved"]:
            any_approved = True
            yield _sse(
                {
                    "type": "tool-output-available",
                    "toolCallId": tool["toolCallId"],
                    "output": {"status": "sent", "messageId": uuid.uuid4().hex[:10]},
                }
            )
        else:
            any_denied = True
            yield _sse({"type": "tool-output-denied", "toolCallId": tool["toolCallId"]})

    if any_approved and not any_denied:
        summary = "Done — I've sent the summary email to the team."
    elif any_denied and not any_approved:
        summary = "Understood — I won't send the email. Let me know if you'd like to revise it."
    else:
        summary = "I've processed your decisions on the pending actions."

    async for ev in _emit_text(summary):
        yield ev

    yield _sse(_trace_event())
    yield _sse({"type": "finish"})
    yield "data: [DONE]\n\n"


async def _mock_turn(
    pending: List[Dict[str, Any]], query: str
) -> AsyncGenerator[str, None]:
    """Canned, credential-free stream — the contract-proving fallback when no LLM/RAG
    creds are present. Both tracks share this identical response stream."""
    if pending:
        async for ev in _resume_turn(pending):
            yield ev
    else:
        async for ev in _initial_turn(query):
            yield ev


def _real_enabled() -> bool:
    """Whether to drive a REAL agent loop instead of the mock.

    `AGENT_CHAT_MODE=real` forces it, `=mock` forces the canned stream, and the default
    (`auto`) turns it on once an LLM key + a real Qdrant URL are configured — so a bare
    checkout still serves the contract mock with no credentials.
    """
    mode = os.getenv("AGENT_CHAT_MODE", "auto").strip().lower()
    if mode == "mock":
        return False
    if mode == "real":
        return True
    qdrant = os.getenv("QDRANT_URL", "")
    has_creds = (
        bool(os.getenv("OPENAI_API_KEY"))
        and bool(qdrant)
        and not qdrant.startswith("https://your-")
    )
    return has_creds


def _build_response(body: Dict[str, Any], track: str) -> StreamingResponse:
    """Pick the real agent loop or the mock, then frame it as a v6 SSE response. The
    response stream is identical across tracks; only request parsing differs."""
    messages: List[Dict[str, Any]] = body.get("messages") or []
    pending = (
        _pending_approvals_agenta(body)
        if track == "agenta"
        else _pending_approvals_uimessage(messages)
    )

    if _real_enabled():
        # Lazy import: pulls litellm / qdrant / agenta only in real mode, so the
        # credential-free contract_main stays self-contained.
        from . import agent_loop

        generator = agent_loop.run_turn(body, track, pending)
    else:
        generator = _mock_turn(pending, _last_user_text(messages))

    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "x-vercel-ai-ui-message-stream": "v1",
            "cache-control": "no-cache",
        },
    )


@router.post("/api/agent/chat")
async def agent_chat(request: Request) -> StreamingResponse:
    """Track A — request `messages` is the AI SDK `UIMessage[]` shape (`{role, parts}`)."""
    return _build_response(await request.json(), track="uimessage")


@router.post("/api/agent/chat-agenta")
async def agent_chat_agenta(request: Request) -> StreamingResponse:
    """Track B — request `messages` is the Agenta `{role, content}` shape; the approval
    decision rides in the `tool_approvals` side field."""
    return _build_response(await request.json(), track="agenta")


@router.get("/api/agent/health")
async def agent_health() -> Dict[str, str]:
    return {
        "status": "healthy",
        "endpoint": "contract-stream-mock",
        "tracks": "A=/api/agent/chat (UIMessage parts), B=/api/agent/chat-agenta (Agenta {role,content})",
    }
