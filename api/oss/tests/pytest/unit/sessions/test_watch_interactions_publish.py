"""M3 live relay — interaction publish points (decision §5-2).

`SessionInteractionsService` is the single choke point for approval-gate state
(create / transition / cancel-stale fan-outs all go through it), so it owns the
`interaction` watch events: `pending` on create, `resolved` on any transition
away from pending, and one `resolved` when a cancel sweep actually cancelled
something (a no-op sweep publishes nothing).
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.sessions.interactions.dtos import (
    SessionInteraction,
    SessionInteractionCreate,
    SessionInteractionData,
    SessionInteractionKind,
    SessionInteractionStatus,
    SessionInteractionTransition,
)
from oss.src.core.sessions.interactions.service import (
    SessionInteractionsService,
    _watch_interaction_state,
)


_PROJECT = uuid4()


class _RecordingPublisher:
    def __init__(self):
        self.interaction_calls: list[tuple[str, str, str, list[dict] | None]] = []

    async def interaction(self, **kwargs) -> None:
        self.interaction_calls.append(
            (
                kwargs["project_id"],
                kwargs["session_id"],
                kwargs["status"],
                kwargs.get("interactions"),
            )
        )


def _interaction(session_id: str) -> SessionInteraction:
    return SessionInteraction(
        id=uuid4(),
        project_id=_PROJECT,
        session_id=session_id,
        token="tok-1",
        kind=SessionInteractionKind.user_approval,
        status=SessionInteractionStatus.pending,
    )


def _service(dao):
    publisher = _RecordingPublisher()
    return (
        SessionInteractionsService(interactions_dao=dao, watch_publisher=publisher),
        publisher,
    )


@pytest.mark.asyncio
async def test_create_publishes_pending():
    dao = AsyncMock()
    dao.create_interaction = AsyncMock(return_value=_interaction("sess-1"))
    svc, publisher = _service(dao)

    await svc.create_interaction(
        project_id=_PROJECT,
        interaction=SessionInteractionCreate(
            project_id=_PROJECT,
            session_id="sess-1",
            token="tok-1",
            kind=SessionInteractionKind.user_approval,
        ),
    )

    assert publisher.interaction_calls == [
        (
            str(_PROJECT),
            "sess-1",
            "pending",
            [_watch_interaction_state(dao.create_interaction.return_value)],
        )
    ]


@pytest.mark.asyncio
async def test_transition_publishes_resolved():
    dao = AsyncMock()
    resolved = _interaction("sess-1").model_copy(
        update={
            "status": SessionInteractionStatus.responded,
            "data": SessionInteractionData(
                resolution={"verdict": "approved", "tool_call_id": "tool-1"}
            ),
        }
    )
    dao.transition_interaction = AsyncMock(return_value=resolved)
    svc, publisher = _service(dao)

    await svc.transition_interaction(
        transition=SessionInteractionTransition(
            project_id=_PROJECT,
            session_id="sess-1",
            token="tok-1",
            status=SessionInteractionStatus.responded,
        ),
    )

    assert publisher.interaction_calls == [
        (
            str(_PROJECT),
            "sess-1",
            "resolved",
            [_watch_interaction_state(resolved)],
        )
    ]


@pytest.mark.asyncio
async def test_failed_transition_publishes_nothing():
    from oss.src.core.sessions.interactions.types import InteractionNotFound

    dao = AsyncMock()
    dao.transition_interaction = AsyncMock(return_value=None)
    svc, publisher = _service(dao)

    with pytest.raises(InteractionNotFound):
        await svc.transition_interaction(
            transition=SessionInteractionTransition(
                project_id=_PROJECT,
                session_id="sess-1",
                token="tok-1",
                status=SessionInteractionStatus.responded,
            ),
        )

    assert publisher.interaction_calls == []


@pytest.mark.asyncio
async def test_cancel_sweep_publishes_resolved_only_when_it_cancelled():
    dao = AsyncMock()
    dao.cancel_session_pending = AsyncMock(
        return_value=[
            _interaction("sess-1"),
            _interaction("sess-1").model_copy(update={"token": "tok-2"}),
        ]
    )
    svc, publisher = _service(dao)

    cancelled = await svc.cancel_session_pending(
        project_id=_PROJECT, session_id="sess-1"
    )
    assert cancelled == 2
    assert publisher.interaction_calls == [(str(_PROJECT), "sess-1", "resolved", None)]

    # No-op sweep: nothing was pending, nothing changed, nothing to notify.
    dao.cancel_session_pending = AsyncMock(return_value=[])
    publisher.interaction_calls.clear()
    await svc.cancel_session_pending(project_id=_PROJECT, session_id="sess-1")
    assert publisher.interaction_calls == []
