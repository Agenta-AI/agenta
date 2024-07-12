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
        # v used to save the trace configuration before starting the first span
        self.span_config: Dict[str, Any] = {}
        self.active_span: Optional[CreateSpan] = None
        self.tracked_spans: Dict[str, CreateSpan] = {}
        self.closed_spans: List[CreateSpan] = []


tracing_context = contextvars.ContextVar(
    CURRENT_TRACING_CONTEXT_KEY, default=TracingContext()
)
