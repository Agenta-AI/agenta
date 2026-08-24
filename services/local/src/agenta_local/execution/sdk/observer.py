"""Neutral-stream observation: tee events, track terminal state, project to Vercel frames.

Testable offline: ``observe_and_project`` takes any async iterable of neutral
``{"type", "data"}`` dicts and an injectable projector callable defaulting to the real SDK
Vercel projection.
"""

import asyncio
from collections.abc import AsyncIterator, Callable
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any

from agenta.sdk.agents.adapters.vercel.stream import agent_stream_to_vercel_stream
from agenta.sdk.agents.fold import assistant_text

from ...core.execution.dtos import ExecutionResult
from ...core.execution.errors import ExecutionError

Projector = Callable[..., AsyncIterator[dict[str, Any]]]

DEFAULT_PROJECTOR: Projector = agent_stream_to_vercel_stream


@dataclass
class StreamObservation:
    """Terminal-state ledger for one neutral stream; feeds the deferred result()."""

    events: list[dict[str, Any]] = field(default_factory=list)
    error_event: bool = False
    source_exception: BaseException | None = None
    cancelled: bool = False
    exhausted: bool = False
    _terminal: asyncio.Event = field(default_factory=asyncio.Event)

    def mark_terminal(self) -> None:
        self._terminal.set()

    async def wait_terminal(self) -> None:
        await self._terminal.wait()


def observe_and_project(
    neutral: AsyncIterator[dict[str, Any]],
    *,
    projector: Projector = DEFAULT_PROJECTOR,
) -> tuple[AsyncIterator[dict[str, Any]], StreamObservation]:
    """Tee the neutral iterator and project it; returns (vercel frames, observation)."""
    observation = StreamObservation()
    observed = _observed(neutral, observation)
    return _projected(observed, projector), observation


async def _observed(
    neutral: AsyncIterator[dict[str, Any]],
    observation: StreamObservation,
) -> AsyncIterator[dict[str, Any]]:
    try:
        async for event in neutral:
            observation.events.append(event)
            if event.get("type") == "error":
                observation.error_event = True
            yield event
        observation.exhausted = True
    except asyncio.CancelledError:
        observation.cancelled = True
        raise
    except Exception as exc:
        observation.source_exception = exc
        raise
    finally:
        observation.mark_terminal()
        await _close_quietly(neutral)


async def _projected(
    observed: AsyncIterator[dict[str, Any]],
    projector: Projector,
) -> AsyncIterator[dict[str, Any]]:
    frames = projector(observed)
    try:
        async for frame in frames:
            yield frame
    finally:
        # Closing mid-stream must tear down everything below the projection.
        await _close_quietly(frames)
        await _close_quietly(observed)


async def _close_quietly(iterator: Any) -> None:
    with suppress(Exception):
        await iterator.aclose()  # type: ignore[attr-defined]


async def turn_result(observation: StreamObservation) -> ExecutionResult:
    """The deferred result: succeeds only after clean neutral-stream exhaustion."""
    await observation.wait_terminal()
    if observation.source_exception is not None:
        raise ExecutionError("agent stream raised mid-turn") from (
            observation.source_exception
        )
    if not observation.exhausted:
        detail = "cancelled" if observation.cancelled else "closed before completion"
        raise ExecutionError(f"agent run was {detail}")
    if observation.error_event:
        raise ExecutionError("agent run emitted an error event")
    return ExecutionResult(assistant_text=assistant_text(observation.events))
