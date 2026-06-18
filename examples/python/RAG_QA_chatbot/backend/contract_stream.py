"""`POST /messages` — the RFC agent protocol endpoint (real agent loop + mock fallback).

Serves the **v6 UI Message Stream protocol** the frontend `useChat` hook consumes, behind
the RFC envelope (`docs/design/agent-workflows/agent-protocol-rfc.md`):

    { "session_id"?, "references"?, "data": { "messages": UIMessage[], "parameters"? } }

The conversation is `data.messages` in the AI SDK `UIMessage[]` (parts) shape — the RFC's
chosen contract (it rejects the `{role, content}` shape for `/messages`). `session_id` is
echoed on the `start` part's `messageMetadata.sessionId`.

Two execution modes behind the same wire contract:

  * **Real** (default once creds exist) — a genuine LLM function-calling loop in
    `agent_loop.py`: real `search_docs` retrieval (Qdrant), a real approval-gated
    `send_summary_email`, real streamed tokens, and a real Agenta trace id.
  * **Mock** (credential-free fallback) — the canned generators below, which emit the
    identical part lifecycle with NO dependency on litellm / qdrant / agenta.

Mode is chosen by `_real_enabled()` (env `AGENT_CHAT_MODE=auto|real|mock`). When real is
active the heavy deps are imported lazily, so `contract_main.py` stays self-contained.

The mock mirrors the full part lifecycle the real agent loop emits:

    start (messageMetadata.sessionId)
      → reasoning-start / -delta / -end
      → text-start / -delta / -end
      → source-url (x2)
      → tool-input-start / -input-available / -output-available   (auto tool, no approval)
      → tool-input-start / -input-available / -approval-request    (tool that needs approval)
      → data-trace → finish (messageMetadata.traceId)

On the follow-up request the FE re-POSTs the full history (`data.messages`) with the tool
part in `approval-responded` state; we detect it and resume with
`tool-output-available | tool-output-denied`, then a final answer.

Wire framing: SSE, each event `data: <json>\\n\\n`, terminated by `data: [DONE]\\n\\n`,
response header `x-vercel-ai-ui-message-stream: v1`.

NOTE: approvals are an Agenta extension — they are not (yet) in the RFC part registry.
"""

import asyncio
import json
import os
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional

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
    """Last user text from the UIMessage `parts` (tolerates a `content` string too)."""
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


def _start_event(session_id: Optional[str]) -> Dict[str, Any]:
    start: Dict[str, Any] = {"type": "start", "messageId": str(uuid.uuid4())}
    if session_id:
        start["messageMetadata"] = {"sessionId": session_id}
    return start


async def _initial_turn(
    query: str, session_id: Optional[str] = None
) -> AsyncGenerator[str, None]:
    yield _sse(_start_event(session_id))

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


async def _resume_turn(
    pending: List[Dict[str, Any]], session_id: Optional[str] = None
) -> AsyncGenerator[str, None]:
    yield _sse(_start_event(session_id))

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
    pending: List[Dict[str, Any]], query: str, session_id: Optional[str] = None
) -> AsyncGenerator[str, None]:
    """Canned, credential-free stream — the contract-proving fallback when no LLM/RAG
    creds are present."""
    if pending:
        async for ev in _resume_turn(pending, session_id):
            yield ev
    else:
        async for ev in _initial_turn(query, session_id):
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


@router.post("/messages")
async def messages(request: Request) -> StreamingResponse:
    """RFC `POST /messages`. The conversation is `data.messages` (AI SDK `UIMessage[]`);
    `session_id`/`references` sit at the envelope top level; the agent config is
    `data.parameters`. Picks the real agent loop or the credential-free mock, then frames
    the response as a v6 UI Message Stream."""
    body: Dict[str, Any] = await request.json()
    data: Dict[str, Any] = body.get("data") or {}
    ui_messages: List[Dict[str, Any]] = data.get("messages") or []
    session_id: Optional[str] = body.get("session_id")
    pending = _pending_approvals_uimessage(ui_messages)

    if _real_enabled():
        # Lazy import: pulls litellm / qdrant / agenta only in real mode, so the
        # credential-free contract_main stays self-contained.
        from . import agent_loop

        generator = agent_loop.run_turn(ui_messages, pending, session_id)
    else:
        generator = _mock_turn(pending, _last_user_text(ui_messages), session_id)

    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "x-vercel-ai-ui-message-stream": "v1",
            "cache-control": "no-cache",
        },
    )


@router.get("/messages/health")
async def messages_health() -> Dict[str, str]:
    return {
        "status": "healthy",
        "endpoint": "POST /messages (RFC agent protocol; UIMessage parts)",
    }
