from typing import Any, Dict, List, Optional

from contextlib import contextmanager
from contextvars import ContextVar, Token

from pydantic import BaseModel


class RoutingContext(BaseModel):
    parameters: Optional[Dict[str, Any]] = None
    secrets: Optional[List[Any]] = None
    mock: Optional[str] = None

    @classmethod
    def get(cls) -> "RoutingContext":
        try:
            return routing_context.get()
        except LookupError:
            return RoutingContext()

    @classmethod
    def set(cls, ctx: "RoutingContext") -> Token:
        return routing_context.set(ctx)

    @classmethod
    def reset(cls, token: Token) -> None:
        return routing_context.reset(token)


routing_context: ContextVar[RoutingContext] = ContextVar("routing_context")


@contextmanager
def routing_context_manager(context: RoutingContext):
    token = RoutingContext.set(context)
    try:
        yield
    finally:
        RoutingContext.reset(token)
