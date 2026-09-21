"""Shared plumbing for the runner-backed adapters: the ``/run`` wire shape and the two
transports to the TypeScript runner."""

from .ts_runner import (
    AGENT_DEFAULT_TIMEOUT,
    deliver_http_result,
    deliver_http_stream,
    deliver_subprocess_result,
    deliver_subprocess_stream,
)
from .wire import request_to_wire, result_from_wire

__all__ = [
    "AGENT_DEFAULT_TIMEOUT",
    "request_to_wire",
    "result_from_wire",
    "deliver_http_result",
    "deliver_subprocess_result",
    "deliver_http_stream",
    "deliver_subprocess_stream",
]
