from inspect import iscoroutinefunction
from functools import wraps

from agenta.sdk.utils.logging import log

DEBUG = False
SHIFT = 7


def debug(shift=1, req=False, res=False, chars=[">", "<"]):
    def log_decorator(f):
        is_async = iscoroutinefunction(f)

        @wraps(f)
        async def async_log_wrapper(*args, **kwargs):
            if DEBUG:
                log.debug(
                    " ".join(
                        [
                            chars[0] * shift + " " * (SHIFT - shift),
                            f.__name__ + " ()",
                            str(args) if req else "",
                            str(kwargs) if req else "",
                        ]
                    )
                )
            result = await f(*args, **kwargs)
            if DEBUG:
                log.debug(
                    " ".join(
                        [
                            chars[1] * shift + " " * (SHIFT - shift),
                            f.__name__ + " <-",
                            str(result) if res else "",
                        ]
                    )
                )
            return result

        @wraps(f)
        def log_wrapper(*args, **kwargs):
            if DEBUG:
                log.debug(
                    " ".join(
                        [
                            chars[0] * shift + " " * (SHIFT - shift),
                            f.__name__ + " ()",
                            str(args) if req else "",
                            str(kwargs) if req else "",
                        ]
                    )
                )
            result = f(*args, **kwargs)
            if DEBUG:
                log.debug(
                    " ".join(
                        [
                            chars[1] * shift + " " * (SHIFT - shift),
                            f.__name__ + " <-",
                            str(result) if res else "",
                        ]
                    )
                )
            return result

        return async_log_wrapper if is_async else log_wrapper

    return log_decorator
