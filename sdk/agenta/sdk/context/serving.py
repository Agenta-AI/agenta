from typing import Any, Dict, List, Optional

from contextlib import contextmanager
from contextvars import ContextVar

from pydantic import BaseModel


class RoutingContext(BaseModel):
    parameters: Optional[Dict[str, Any]] = None
    secrets: Optional[List[Any]] = None
    mock: Optional[str] = None


serving_context = ContextVar("serving_context", default=RoutingContext())


@contextmanager
def serving_context_manager(
    *,
    context: Optional[RoutingContext] = None,
):
    token = serving_context.set(context)
    try:
        yield
    finally:
        serving_context.reset(token)
