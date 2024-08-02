# Stdlib Imports
import inspect
import traceback
from functools import wraps
from typing import Any, Callable, Optional

# Own Imports
import agenta as ag
from agenta.sdk.decorators.base import BaseDecorator
from agenta.sdk.tracing.logger import llm_logger as logging
from agenta.sdk.utils.debug import debug, DEBUG, SHIFT


logging.setLevel("DEBUG")


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
        self,
        config: Optional[dict] = None,
        spankind: str = "workflow",
    ) -> None:
        self.config = config
        self.spankind = spankind

    def __call__(self, func: Callable[..., Any]):
        is_coroutine_function = inspect.iscoroutinefunction(func)

        def get_inputs(*args, **kwargs):
            func_args = inspect.getfullargspec(func).args
            input_dict = {name: value for name, value in zip(func_args, args)}
            input_dict.update(kwargs)

            return input_dict

        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            async def wrapped_func(*args, **kwargs):
                with ag.tracing.Context(
                    name=func.__name__,
                    input=get_inputs(*args, **kwargs),
                    spankind=self.spankind,
                    config=self.config,
                ):
                    result = await func(*args, **kwargs)

                    ag.tracing.store_outputs(result)

                    return result

            return await wrapped_func(*args, **kwargs)

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            def wrapped_func(*args, **kwargs):
                with ag.tracing.Context(
                    name=func.__name__,
                    input=get_inputs(*args, **kwargs),
                    spankind=self.spankind,
                    config=self.config,
                ):
                    result = func(*args, **kwargs)

                    ag.tracing.store_outputs(result)

                    return result

            return wrapped_func(*args, **kwargs)

        return async_wrapper if is_coroutine_function else sync_wrapper
