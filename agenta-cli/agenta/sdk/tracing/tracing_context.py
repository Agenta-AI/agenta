from contextvars import ContextVar

from typing import Optional, Dict, List

from agenta.client.backend.types.create_span import CreateSpan

CURRENT_TRACING_CONTEXT_KEY = "current_tracing_context"


class TracingContext:
    def __init__(self):
        ### --- TRACE --- ###
        self.trace_id: Optional[str] = None
        self.trace_tags: List[str] = []

        ### --- SPANS --- ###
        self.active_span: Optional[CreateSpan] = None
        self.spans: Dict[str, CreateSpan] = {}

    def __repr__(self) -> str:
        return f"TracingContext(trace='{self.trace_id}', spans={[f'{span.id} {span.spankind}' for span in self.spans.values()]})"

    def __str__(self) -> str:
        return self.__repr__()


tracing_context = ContextVar(CURRENT_TRACING_CONTEXT_KEY, default=None)
