# Stdlib Imports
import inspect
from functools import wraps
from typing import Any, Callable

# Own Imports
import agenta as ag
from agenta.sdk.decorators.base import BaseDecorator


class span(BaseDecorator):
    """Decorator class for starting and ending spans of a trace.

    Args:
        BaseDecorator (object): base decorator class

    Example:
    ```python
        import agenta as ag

        @ag.span(type="llm")
        async def openai_llm_call(prompt: str):
            return ...
    ```
    """

    def __init__(self, type: str):
        self.type = type
        self.trace = ag.llm_tracing()

    def __call__(self, func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            result = None
            span = self.trace.start_span(
                name=func.__name__,
                input=kwargs,
                spankind=self.type,
            )
            try:
                is_coroutine_function = inspect.iscoroutinefunction(func)
                if is_coroutine_function:
                    result = await func(*args, **kwargs)
                else:
                    result = func(*args, **kwargs)
                self.trace.update_span_status(span=span, value="OK")
            except Exception as e:
                result = str(e)
                self.trace.update_span_status(span=span, value="ERROR")
            finally:
                if not isinstance(result, dict):
                    result = {"message": result}
                self.trace.end_span(outputs=result, span=span)
            return result

        return wrapper
