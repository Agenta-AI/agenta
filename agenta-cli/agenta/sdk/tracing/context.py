from contextvars import ContextVar
from contextlib import contextmanager
from traceback import format_exc

from agenta.sdk.utils.logging import log

tracing_context = ContextVar("tracing_context", default={})


@contextmanager
def tracing_context_manager():
    _tracing_context = {"health": {"status": "ok"}}

    token = tracing_context.set(_tracing_context)
    try:
        yield
    except Exception as e:
        log.error(f"Error with tracing context: {_tracing_context}")
        log.error(f"Exception: {format_exc()}")
    finally:
        tracing_context.reset(token)
