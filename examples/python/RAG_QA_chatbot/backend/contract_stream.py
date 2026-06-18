"""Agent chat slice endpoints — the real LLM agent loop over the v6 UI Message Stream.

Two endpoints serve the streaming agent chat the frontend `useChat` hook consumes, one per
request-contract track (the team is still comparing them — see
`docs/design/agent-workflows/frontend-agent-chat-ui.md`):

  * **Track A** — `POST /api/agent/chat`. `messages` is the AI SDK `UIMessage[]` (parts);
    the approval decision rides inside the assistant message's tool part.
  * **Track B** — `POST /api/agent/chat-agenta`. `messages` is the Agenta `{role, content}`
    shape; the approval decision rides in a top-level `tool_approvals` side field.

The response stream is identical across tracks. Both delegate to the real agent loop in
`agent_loop.py` (real LLM function-calling, real `search_docs` retrieval, an approval-gated
`send_summary_email`, a real Agenta trace). **Credentials are required** — set up
`.env` (OPENAI_API_KEY + QDRANT_URL/KEY + AGENTA_*) and ingest the docs; there is no
credential-free mock. The framing is SSE (`data: <json>\\n\\n`, terminated by `[DONE]`,
header `x-vercel-ai-ui-message-stream: v1`); `session_id` is echoed on the `start` part's
`messageMetadata.sessionId`.
"""

from typing import Any, Dict, List

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from . import agent_loop

router = APIRouter()


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


def _build_response(body: Dict[str, Any], track: str) -> StreamingResponse:
    """Parse the request per track, then stream the real agent loop as a v6 SSE response."""
    messages: List[Dict[str, Any]] = body.get("messages") or []
    pending = (
        _pending_approvals_agenta(body)
        if track == "agenta"
        else _pending_approvals_uimessage(messages)
    )
    return StreamingResponse(
        agent_loop.run_turn(body, track, pending),
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
    return {"status": "healthy", "endpoint": "agent chat slice (real agent loop)"}
