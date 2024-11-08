import logging
import inspect
from functools import wraps


logger = logging.getLogger(__name__)


def handle_exceptions():
    def decorator(func):
        is_coroutine_function = inspect.iscoroutinefunction(func)

        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                logger.error("--- HANDLING EXCEPTION ---")
                logger.error("--------------------------")
                raise e

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                logger.error("--- HANDLING EXCEPTION ---")
                logger.error("--------------------------")
                raise e

        return async_wrapper if is_coroutine_function else sync_wrapper

    return decorator
