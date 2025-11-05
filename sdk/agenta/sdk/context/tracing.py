from typing import Any, Dict, Optional

from contextlib import contextmanager
from contextvars import ContextVar, Token

from pydantic import BaseModel


class TracingContext(BaseModel):
    traceparent: Optional[Dict[str, Any]] = None
    baggage: Optional[Dict[str, Any]] = None
    credentials: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None
    references: Optional[Dict[str, Any]] = None
    link: Optional[Dict[str, Any]] = None
    type: Optional[str] = None

    @classmethod
    def get(cls) -> "TracingContext":
        try:
            return tracing_context.get()
        except LookupError:
            return TracingContext()

    @classmethod
    def set(cls, ctx: "TracingContext") -> Token:
        return tracing_context.set(ctx)

    @classmethod
    def reset(cls, token: Token) -> None:
        return tracing_context.reset(token)


tracing_context: ContextVar[TracingContext] = ContextVar("ag.tracing_context")


@contextmanager
def tracing_context_manager(context: TracingContext):
    token = TracingContext.set(context)
    try:
        yield
    finally:
        TracingContext.reset(token)


class OTLPContext(BaseModel):
    credentials: Optional[str] = None

    @classmethod
    def get(cls) -> "OTLPContext":
        try:
            return otlp_context.get()
        except LookupError:
            return OTLPContext()

    @classmethod
    def set(cls, ctx: "OTLPContext") -> Token:
        return otlp_context.set(ctx)

    @classmethod
    def reset(cls, token: Token) -> None:
        return otlp_context.reset(token)


otlp_context: ContextVar[OTLPContext] = ContextVar("ag.otlp_context")


@contextmanager
def otlp_context_manager(context: OTLPContext):
    token = otlp_context.set(context)
    try:
        yield
    finally:
        otlp_context.reset(token)
