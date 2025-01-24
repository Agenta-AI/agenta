from typing import Any, Dict, List, Optional

from contextlib import contextmanager
from contextvars import ContextVar

from pydantic import BaseModel


class RoutingContext(BaseModel):
    parameters: Optional[Dict[str, Any]] = None
    secrets: Optional[List[Any]] = None
    mock: Optional[str] = None


routing_context = ContextVar("routing_context", default=RoutingContext())


@contextmanager
def routing_context_manager(
    *,
    context: Optional[RoutingContext] = None,
):
    token = routing_context.set(context)
    try:
        yield
    finally:
        routing_context.reset(token)
