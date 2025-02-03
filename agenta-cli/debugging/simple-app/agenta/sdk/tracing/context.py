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
    except:  # pylint: disable=bare-except
        log.warning("----------------------------------------------")
        log.warning("Agenta SDK - handling tracing exception below:")
        log.warning("----------------------------------------------")
        log.warning(format_exc().strip("\n"))
        log.warning("----------------------------------------------")
    finally:
        tracing_context.reset(token)
