from contextlib import AbstractContextManager
from traceback import format_exc
from functools import wraps
from inspect import iscoroutinefunction

from agenta.sdk.utils.logging import log


class suppress(AbstractContextManager):  # pylint: disable=invalid-name
    def __init__(self):
        pass

    def __enter__(self):
        pass

    def __exit__(self, exc_type, exc_value, exc_tb):
        if exc_type is None:
            return True
        else:
            log.warning("-------------------------------------------------")
            log.warning("Agenta SDK - suppressing tracing exception below:")
            log.warning("-------------------------------------------------")
            log.warning(format_exc().strip("\n"))
            log.warning("-------------------------------------------------")
            return True


def handle_exceptions():
    def decorator(func):
        is_coroutine_function = iscoroutinefunction(func)

        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                log.warning("------------------------------------------")
                log.warning("Agenta SDK - intercepting exception below:")
                log.warning("------------------------------------------")
                log.warning(format_exc().strip("\n"))
                log.warning("------------------------------------------")
                raise e

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                log.warning("------------------------------------------")
                log.warning("Agenta SDK - intercepting exception below:")
                log.warning("------------------------------------------")
                log.warning(format_exc().strip("\n"))
                log.warning("------------------------------------------")
                raise e

        return async_wrapper if is_coroutine_function else sync_wrapper

    return decorator
