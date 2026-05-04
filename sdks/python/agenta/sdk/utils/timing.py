import time
from functools import wraps

from agenta.sdk.utils.logging import get_module_logger

log = get_module_logger(__name__)


def timeit(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        start_time = time.time()
        result = func(*args, **kwargs)
        end_time = time.time()

        execution_time = end_time - start_time

        if execution_time < 1e-3:
            time_value = execution_time * 1e6
            unit = "us"
        elif execution_time < 1:
            time_value = execution_time * 1e3
            unit = "ms"
        else:
            time_value = execution_time
            unit = "s"

        class_name = args[0].__class__.__name__ if args else None

        log.info(f"'{class_name}.{func.__name__}' executed in {time_value:.4f} {unit}.")
        return result

    return wrapper


def atimeit(func):
    @wraps(func)
    async def wrapper(*args, **kwargs):
        start_time = time.time()
        result = await func(*args, **kwargs)
        end_time = time.time()

        execution_time = end_time - start_time

        if execution_time < 1e-3:
            time_value = execution_time * 1e6
            unit = "us"
        elif execution_time < 1:
            time_value = execution_time * 1e3
            unit = "ms"
        else:
            time_value = execution_time
            unit = "s"

        class_name = args[0].__class__.__name__ if args else None

        log.info(f"'{class_name}.{func.__name__}' executed in {time_value:.4f} {unit}.")
        return result

    return wrapper
