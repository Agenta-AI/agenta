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
    type: Optional[str] = None


tracing_context = ContextVar(
    "ag.tracing_context",
    default=TracingContext(),
)


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


class TracingExporterContext(BaseModel):
    credentials: Optional[str] = None


tracing_exporter_context = ContextVar(
    "ag.tracing_exporter_context",
    default=TracingExporterContext(),
)


@contextmanager
def tracing_exporter_context_manager(
    *,
    context: Optional[TracingExporterContext] = None,
):
    token = tracing_exporter_context.set(context)
    try:
        yield
    finally:
        tracing_exporter_context.reset(token)
