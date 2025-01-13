from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Dict, Optional

routing_context = ContextVar("routing_context", default={})


@contextmanager
def routing_context_manager(
    *,
    config: Optional[Dict[str, Any]] = None,
    application: Optional[Dict[str, Any]] = None,
    variant: Optional[Dict[str, Any]] = None,
    environment: Optional[Dict[str, Any]] = None,
):
    context = {
        "config": config,
        "application": application,
        "variant": variant,
        "environment": environment,
    }
    token = routing_context.set(context)
    try:
        yield
    finally:
        routing_context.reset(token)
