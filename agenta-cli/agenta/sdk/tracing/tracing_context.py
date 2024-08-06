import contextvars

from typing import Optional, Dict, Any, List

from agenta.client.backend.types.create_span import CreateSpan

CURRENT_TRACING_CONTEXT_KEY = "current_tracing_context"


class TracingContext:
    def __init__(self):
        ### --- TRACE --- ###
        self.trace_id: Optional[str] = None
        self.trace_tags: List[str] = []

        ### --- SPANS --- ###
        self.active_span: Optional[CreateSpan] = None
        self.tracked_spans: Dict[str, CreateSpan] = {}
        self.closed_spans: List[CreateSpan] = []

    def __repr__(self) -> str:
        return f"TracingContext(trace_id=[{self.trace_id}], active_span=[{self.active_span.id if self.active_span else None}{' ' + self.active_span.spankind if self.active_span else ''}])"

    def __str__(self) -> str:
        return self.__repr__()


tracing_context = contextvars.ContextVar(CURRENT_TRACING_CONTEXT_KEY, default=None)
