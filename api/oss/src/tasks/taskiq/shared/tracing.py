"""A server span around each TaskIQ task run.

taskiq ships an OpenTelemetry middleware, but it imports psutil and records metrics too.
This one only opens a CONSUMER span per run and makes it the parent of the run's server
spans, as a request span is for a request.
"""

from typing import Any, Dict, Tuple

from opentelemetry.trace import SpanKind, Status, StatusCode
from taskiq import TaskiqMessage, TaskiqMiddleware, TaskiqResult

from agenta.sdk.engines.tracing.server import attach_server_span, detach_server_span


class ServerTracingMiddleware(TaskiqMiddleware):
    def __init__(self, tracer: Any) -> None:
        super().__init__()
        self._tracer = tracer
        self._runs: Dict[str, Tuple[Any, object]] = {}

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
        self._runs[message.task_id] = (span, attach_server_span(span))
        return message

    def on_error(
        self,
        message: TaskiqMessage,
        result: TaskiqResult[Any],
        exception: BaseException,
    ) -> None:
        run = self._runs.get(message.task_id)
        if run is not None:
            # the type only: an exception message can carry tenant data
            run[0].set_attribute("error.type", type(exception).__name__)

    def post_execute(self, message: TaskiqMessage, result: TaskiqResult[Any]) -> None:
        run = self._runs.pop(message.task_id, None)
        if run is None:
            return
        span, token = run
        if result.is_err:
            span.set_status(Status(StatusCode.ERROR))
        detach_server_span(token)
        span.end()
