"""Execution-boundary DTOs shared with the SDK adapter layer."""

from collections.abc import AsyncIterator, Awaitable
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, RootModel


class ExecutionCredential(BaseModel):
    provider: str
    api_key: str
    base_url: str | None = None


class ExecutionMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ExecutionEvent(RootModel[dict[str, Any]]):
    """One neutral/Vercel stream frame as a passthrough mapping."""

    @property
    def payload(self) -> dict[str, Any]:
        return self.root


class ExecutionResult(BaseModel):
    assistant_text: str


@dataclass
class ExecutionStream:
    """The executor's return value: a live event iterator plus its deferred result.

    ``result()`` becomes available only after ``events`` is exhausted; the adapter
    (S1.2) injects its coroutine. Until then it raises.
    """

    events: AsyncIterator[ExecutionEvent]
    _result: Awaitable[ExecutionResult] | None = field(default=None)

    def result(self) -> Awaitable[ExecutionResult]:
        if self._result is None:
            raise NotImplementedError("result() is available only after injection")
        return self._result
