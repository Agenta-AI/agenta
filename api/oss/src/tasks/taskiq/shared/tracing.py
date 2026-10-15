"""A server span around each TaskIQ task run.

taskiq ships an OpenTelemetry middleware, but it imports psutil and records metrics too.
This one only opens a CONSUMER span per run and makes it the parent of the run's server
spans, as a request span is for a request.
"""

from contextvars import ContextVar
from typing import Any, Optional, Tuple

from opentelemetry.trace import SpanKind, Status, StatusCode
from taskiq import TaskiqMessage, TaskiqMiddleware, TaskiqResult

from agenta.sdk.engines.tracing.server import attach_server_span, detach_server_span


# The span and context token of the run in this context. taskiq runs each message in its
# own asyncio task, so a context variable is per execution: two deliveries of one task_id
# (a reclaimed message) never share state, and a run that never reaches post_execute leaves
# nothing behind.
_RUN: ContextVar[Optional[Tuple[Any, object]]] = ContextVar(
    "agenta_taskiq_server_span", default=None
)


class ServerTracingMiddleware(TaskiqMiddleware):
    def __init__(self, tracer: Any) -> None:
        super().__init__()
        self._tracer = tracer

    def pre_execute(self, message: TaskiqMessage) -> TaskiqMessage:
        span = self._tracer.start_span(
            f"run {message.task_name}",
            kind=SpanKind.CONSUMER,
            attributes={
                "messaging.system": "taskiq",
                "messaging.operation.type": "process",
                "taskiq.task_name": message.task_name,
                "taskiq.task_id": message.task_id,
            },
        )
        # pre_execute, the task and post_execute share one coroutine, so one context
        _RUN.set((span, attach_server_span(span)))
        return message

    def on_error(
        self,
        message: TaskiqMessage,
        result: TaskiqResult[Any],
        exception: BaseException,
    ) -> None:
        run = _RUN.get()
        if run is not None:
            # the type only: an exception message can carry tenant data
            run[0].set_attribute("error.type", type(exception).__name__)

    def post_execute(self, message: TaskiqMessage, result: TaskiqResult[Any]) -> None:
        run = _RUN.get()
        if run is None:
            return
        _RUN.set(None)
        span, token = run
        if result.is_err:
            span.set_status(Status(StatusCode.ERROR))
        detach_server_span(token)
        span.end()
