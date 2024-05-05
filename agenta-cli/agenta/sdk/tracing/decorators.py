# Stdlib Imports
import inspect
from functools import wraps

# Own Imports
import agenta as ag


def span(type: str):
    """Decorator to automatically start and end spans."""

    tracing = ag.llm_tracing()

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            result = None
            span = tracing.start_span(
                name=func.__name__,
                input=kwargs,
                spankind=type,
            )
            try:
                is_coroutine_function = inspect.iscoroutinefunction(func)
                if is_coroutine_function:
                    result = await func(*args, **kwargs)
                else:
                    result = func(*args, **kwargs)
                tracing.update_span_status(span=span, value="OK")
            except Exception as e:
                result = str(e)
                tracing.update_span_status(span=span, value="ERROR")
            finally:
                if not isinstance(result, dict):
                    result = {"message": result}
                tracing.end_span(outputs=result, span=span)
            return result

        return wrapper

    return decorator
