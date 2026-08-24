"""SDK-backed executor: handler neutral stream -> observed Vercel ExecutionStream."""

from collections.abc import AsyncIterator
from contextlib import aclosing
from typing import Any

from agenta.sdk.agents.handler import make_agent_handler
from agenta.sdk.models.workflows import WorkflowServiceRequest

from ...core.agents.dtos import AgentRevision
from ...core.execution.dtos import (
    ExecutionCredential,
    ExecutionEvent,
    ExecutionMessage,
    ExecutionResult,
    ExecutionStream,
)
from ...core.execution.interfaces import AgentExecutorInterface
from .composition import build_composition
from .mappings import messages_to_sdk, revision_to_agent_params
from .observer import StreamObservation, observe_and_project, turn_result


class SDKAgentExecutor(AgentExecutorInterface):
    """Runs one cold turn through the SDK agent handler against the local runner."""

    def __init__(self, runner_url: str) -> None:
        self._runner_url = runner_url

    def stream(
        self,
        *,
        revision: AgentRevision,
        messages: list[ExecutionMessage],
        credential: ExecutionCredential,
    ) -> ExecutionStream:
        composition, _ = build_composition(
            runner_url=self._runner_url, credential=credential
        )
        handler = make_agent_handler(composition)
        request = WorkflowServiceRequest(flags={"stream": True}, session_id=None)
        frames_source = _HandlerStream(
            handler,
            request,
            messages_to_sdk(messages),
            revision_to_agent_params(revision),
        )
        frames, observation = observe_and_project(frames_source)
        return ExecutionStream(
            events=_as_execution_events(frames),
            _result=_deferred_result(observation),
        )


class _HandlerStream:
    """Awaits the handler coroutine lazily so the stream stays cold until iterated."""

    def __init__(self, handler, request, messages, parameters) -> None:
        self._handler = handler
        self._request = request
        self._messages = messages
        self._parameters = parameters

    def __aiter__(self) -> "_HandlerStream":
        return self

    async def __anext__(self):
        if not hasattr(self, "_neutral"):
            # The handler is an async function; awaiting it returns the event generator.
            self._neutral = await self._handler(
                self._request,
                messages=self._messages,
                parameters=self._parameters,
            )
        return await self._neutral.__anext__()


async def _as_execution_events(
    frames: AsyncIterator[dict[str, Any]],
) -> AsyncIterator[ExecutionEvent]:
    # Closing this iterator propagates down through the observer to the neutral generator.
    async with aclosing(frames):
        async for frame in frames:
            yield ExecutionEvent(frame)


async def _deferred_result(observation: StreamObservation) -> ExecutionResult:
    return await turn_result(observation)
