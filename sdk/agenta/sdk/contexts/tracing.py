from typing import Optional, Union, Callable
from contextvars import ContextVar, Token
from contextlib import contextmanager

from pydantic import BaseModel


class TracingContext(BaseModel):
    traceparent: Optional[dict] = None
    baggage: Optional[dict] = None
    #
    credentials: Optional[str] = None
    #
    script: Optional[dict] = None
    parameters: Optional[dict] = None
    #
    flags: Optional[dict] = None
    tags: Optional[dict] = None
    meta: Optional[dict] = None
    #
    references: Optional[dict] = None
    links: Optional[dict] = None
    #
    type: Optional[str] = None
    aggregate: Optional[Union[bool, Callable]] = None  # stream to batch
    annotate: Optional[bool] = None  # annotation vs invocation
    #
    link: Optional[dict] = None

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
    token = OTLPContext.set(context)
    try:
        yield
    finally:
        OTLPContext.reset(token)
