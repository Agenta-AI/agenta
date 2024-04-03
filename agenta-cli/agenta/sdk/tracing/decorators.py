# Stdlib Imports
import inspect
from functools import wraps

# Own Imports
import agenta as ag


def span(type: str):
    """Decorator to automatically start and end spans."""

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            result = None
            span = ag.tracing.start_span(
                func.__name__,
                input=kwargs,
                type=type,
                trace_id=ag.tracing.active_trace,
            )
            try:
                is_coroutine_function = inspect.iscoroutinefunction(func)
                if is_coroutine_function:
                    result = await func(*args, **kwargs)
                else:
                    result = func(*args, **kwargs)
                span.update_span_status("COMPLETED")
            except Exception as e:
                span.set_attribute("error", True)
                span.set_attribute("error_message", str(e))
                span.update_span_status("FAILED", exc=str(e))
            finally:
                if not isinstance(result, dict):
                    result = {"message": result}
                ag.tracing.end_span(output=result, span=span)
            return result

        return wrapper

    return decorator
