from typing import Any, Dict, Optional

from contextlib import contextmanager
from contextvars import ContextVar

from pydantic import BaseModel


class TracingContext(BaseModel):
    traceparent: Optional[Dict[str, Any]] = None
    baggage: Optional[Dict[str, Any]] = None
    credentials: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None
    references: Optional[Dict[str, Any]] = None
    link: Optional[Dict[str, Any]] = None


tracing_context = ContextVar("tracing_context", default=TracingContext())


@contextmanager
def tracing_context_manager(
    *,
    context: Optional[TracingContext] = None,
):
    token = tracing_context.set(context)
    try:
        yield
    finally:
        tracing_context.reset(token)
