from typing import Optional
from contextvars import ContextVar, Token
from contextlib import contextmanager

from pydantic import BaseModel


class RoutingContext(BaseModel):
    parameters: Optional[dict] = None
    secrets: Optional[list] = None
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
