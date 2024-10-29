import logging
from functools import wraps


logger = logging.getLogger(__name__)


def handle_exceptions():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                logger.error("--- HANDLING EXCEPTION ---")
                logger.error("--------------------------")
                raise e

        return wrapper

    return decorator
