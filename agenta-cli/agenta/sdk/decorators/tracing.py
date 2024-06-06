# Stdlib Imports
import inspect
import traceback
from functools import wraps
from typing import Any, Callable, Optional

# Own Imports
import agenta as ag
from agenta.sdk.decorators.base import BaseDecorator


class instrument(BaseDecorator):
    """Decorator class for monitoring llm apps functions.

    Args:
        BaseDecorator (object): base decorator class

    Example:
    ```python
        import agenta as ag

        prompt_config = {"system_prompt": ..., "temperature": 0.5, "max_tokens": ...}

        @ag.instrument(spankind="llm")
        async def litellm_openai_call(prompt:str) -> str:
            return "do something"

        @ag.instrument(config=prompt_config) # spankind for parent span defaults to workflow
        async def generate(prompt: str):
            return ...
    ```
    """

    def __init__(
        self, config: Optional[dict] = None, spankind: str = "workflow"
    ) -> None:
        self.config = config
        self.spankind = spankind
        self.tracing = ag.tracing

    def __call__(self, func: Callable[..., Any]):
        is_coroutine_function = inspect.iscoroutinefunction(func)

        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            result = None
            func_args = inspect.getfullargspec(func).args
            input_dict = {name: value for name, value in zip(func_args, args)}
            input_dict.update(kwargs)

            span = self.tracing.start_span(
                name=func.__name__,
                input=input_dict,
                spankind=self.spankind,
                config=self.config,
            )

            try:
                result = await func(*args, **kwargs)
                self.tracing.update_span_status(span=span, value="OK")
            except Exception as e:
                result = str(e)
                self.tracing.set_span_attribute(
                    {"traceback_exception": traceback.format_exc()}
                )
                self.tracing.update_span_status(span=span, value="ERROR")
            finally:
                self.tracing.end_span(
                    outputs=(
                        {"message": result} if not isinstance(result, dict) else result
                    )
                )
            return result

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            result = None
            func_args = inspect.getfullargspec(func).args
            input_dict = {name: value for name, value in zip(func_args, args)}
            input_dict.update(kwargs)

            span = self.tracing.start_span(
                name=func.__name__,
                input=input_dict,
                spankind=self.spankind,
                config=self.config,
            )

            try:
                result = func(*args, **kwargs)
                self.tracing.update_span_status(span=span, value="OK")
            except Exception as e:
                result = str(e)
                self.tracing.set_span_attribute(
                    {"traceback_exception": traceback.format_exc()}
                )
                self.tracing.update_span_status(span=span, value="ERROR")
            finally:
                self.tracing.end_span(
                    outputs=(
                        {"message": result} if not isinstance(result, dict) else result
                    )
                )

        return async_wrapper if is_coroutine_function else sync_wrapper
