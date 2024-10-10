from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Dict, Optional

routing_context = ContextVar("routing_context", default={})


@contextmanager
def routing_context_manager(
    config: Optional[Dict[str, Any]] = None,
    environment: Optional[str] = None,
    version: Optional[str] = None,
    variant: Optional[str] = None,
):
    context = {
        "config": config,
        "environment": environment,
        "version": version,
        "variant": variant,
    }
    token = routing_context.set(context)
    try:
        yield
    finally:
        routing_context.reset(token)
