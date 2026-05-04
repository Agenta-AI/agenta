from contextlib import AbstractContextManager
from traceback import format_exc
from functools import wraps
from inspect import iscoroutinefunction

from agenta.sdk.utils.logging import get_module_logger

log = get_module_logger(__name__)


def display_exception(message: str):
    _len = len("Agenta - ") + len(message) + len(":")
    _bar = "-" * _len

    log.warning(_bar)
    log.warning("Agenta - %s:", message)
    log.warning(_bar)
    log.warning(format_exc().strip("\n"))
    log.warning(_bar)


class suppress(AbstractContextManager):  # pylint: disable=invalid-name
    def __init__(self):
        pass

    def __enter__(self):
        pass

    def __exit__(self, exc_type, exc_value, exc_tb):
        if exc_type is not None:
            display_exception("Exception (suppressed)")

        return True


def handle_exceptions():
    def decorator(func):
        is_coroutine_function = iscoroutinefunction(func)

        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)

            except Exception as e:
                display_exception("Exception")

                raise e

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                display_exception("Exception")

                raise e

        return async_wrapper if is_coroutine_function else sync_wrapper

    return decorator
