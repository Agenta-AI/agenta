from typing import Any, Optional
from uuid import uuid4
from functools import wraps
from traceback import print_exc


from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


def suppress_exceptions(
    default: Optional[Any] = None,
):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except Exception:  # pylint: disable=broad-exception-caught
                log.warn(
                    "Suppressing exception",
                    support_id=str(uuid4()),
                    method=func.__name__,
                )

                print_exc()

                return default

        return wrapper

    return decorator
