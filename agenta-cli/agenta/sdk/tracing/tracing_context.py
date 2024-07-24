from contextvars import ContextVar
from collections import OrderedDict

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
        self.tree = OrderedDict()

    def __repr__(self) -> str:
        return f"TracingContext(trace='{self.trace_id}', spans={[f'{span.id} {span.spankind}' for span in self.spans.values()]}, tree={self.tree})"

    def __str__(self) -> str:
        return self.__repr__()
    
    def push(self, span) -> None:
        self.active_span = span
        self.spans[span.id] = span
        
        if span.parent_span_id is None:
            ### --- ROOT  SPAN  --- ###
            self.tree[span.id] = OrderedDict()
        elif span.parent_span_id in self.tree:
            ### --- OTHER SPANS --- ###
            self.tree[span.parent_span_id][span.id] = OrderedDict()
        else:
            # ERROR : The parent should have been in the tree.
            pass


tracing_context = ContextVar(CURRENT_TRACING_CONTEXT_KEY, default=None)
