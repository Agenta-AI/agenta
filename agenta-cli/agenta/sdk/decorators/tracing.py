# Stdlib Imports
import os
import inspect
from functools import wraps
from typing import Any, Callable, Optional

# Own Imports
import agenta as ag
from agenta.sdk.decorators.base import BaseDecorator


# Set global tracing variable to None
tracing = None


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
        self.tracing = ag.Tracing(
            base_url=os.environ["AGENTA_BASE_URL"],
            app_id=os.environ["AGENTA_APP_ID"],
            api_key=os.environ["AGENTA_API_KEY"],
        )

        # Update tracing variable to be global
        global tracing
        tracing = self.tracing

    def __call__(self, func: Callable[..., Any]):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            result = None
            span = self.tracing.start_span(
                name=func.__name__,
                input=kwargs,
                spankind=self.spankind,
                config=self.config,
            )

            try:
                is_coroutine_function = inspect.iscoroutinefunction(func)
                if is_coroutine_function:
                    result = await func(*args, **kwargs)
                else:
                    result = func(*args, **kwargs)

                self.tracing.update_span_status(span=span, value="OK")
            except Exception as e:
                result = str(e)
                self.tracing.update_span_status(span=span, value="ERROR")
            finally:
                self.tracing.end_span(
                    outputs=(
                        {"message": result} if not isinstance(result, dict) else result
                    ),
                    span=span,
                )
            return result

        return wrapper
