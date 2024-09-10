from contextvars import ContextVar

tracing_context = ContextVar("tracing_context", default={})
