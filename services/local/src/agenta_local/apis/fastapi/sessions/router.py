"""Session routes: CRUD, SSE turn streaming, and explicit stop."""

import json

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from agenta_local.core.execution.dtos import ExecutionRequest
from agenta_local.core.execution.types import CancelledTurn
from agenta_local.core.sessions.types import SessionNotFound

from .models import SessionCreate, TurnRequest, first_text, message_dict

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("")
async def list_sessions(request: Request) -> list[dict]:
    sessions = await request.app.state.sessions.list_sessions()
    return [session.model_dump(mode="json") for session in sessions]


@router.post("", status_code=201)
async def create_session(request: Request, payload: SessionCreate) -> dict:
    session = await request.app.state.sessions.create_session(
        agent_revision_id=payload.agent_revision_id, title=payload.title
    )
    return session.model_dump(mode="json")


@router.get("/{session_id}")
async def get_session(request: Request, session_id: str) -> dict:
    state = request.app.state
    session = await state.sessions.get_session(session_id=session_id)
    if session is None:
        raise SessionNotFound(f"session {session_id} does not exist")
    messages = await state.sessions.list_messages(session_id=session_id)
    return {
        **session.model_dump(mode="json"),
        "messages": [message_dict(message) for message in messages],
    }


@router.post("/{session_id}/turns")
async def stream_turn(request: Request, session_id: str, payload: TurnRequest):
    text = first_text(payload.input)
    execution_request = ExecutionRequest(
        session_id=session_id,
        text=text,
        client_turn_id=payload.context.client_turn_id,
    )
    # Admission is fallible (404/409 domain failures); it must happen before the
    # streaming response starts so error codes stay mappable.
    admission = await request.app.state.execution.admit(execution_request)

    async def event_stream():
        try:
            async for event in request.app.state.execution.stream_admitted(admission):
                frame = json.dumps(event.payload)
                yield f"data: {frame}\n\n"
        except CancelledTurn:
            # The terminal row is committed; the stream just ends.
            return

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store"},
    )


@router.post("/{session_id}/stop")
async def stop_session(request: Request, session_id: str) -> dict:
    stopped = await request.app.state.execution.stop_session(session_id=session_id)
    return {"stopped": stopped}
