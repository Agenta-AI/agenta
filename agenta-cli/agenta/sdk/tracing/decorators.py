# Stdlib Imports
import inspect
from functools import wraps

# Own Imports
from agenta.sdk.tracing.llm_tracing import Tracing


async def span(tracing: Tracing, event_type: str = "llm_request"):
    """Decorator to automatically start and end spans."""

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            span = tracing.start_span(
                func.__name__,
                input=str(args),
                event_type=event_type,
                trace_id=tracing.active_trace,
            )
            result = None
            try:
                is_coroutine_function = inspect.iscoroutinefunction(func)
                if is_coroutine_function:
                    result = await func(*args, **kwargs)
                else:
                    result = func(*args, **kwargs)
            except Exception as e:
                span.set_attribute("error", True)
                span.set_attribute("error_message", str(e))
                raise
            finally:
                if not isinstance(result, dict):
                    result = {"message": result}
                tracing.end_span(output=result, span=span)
            return result

        return wrapper

    return decorator
