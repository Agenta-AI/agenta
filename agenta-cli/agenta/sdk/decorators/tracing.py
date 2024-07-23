# Stdlib Imports
import inspect
import traceback
from functools import wraps
from typing import Any, Callable, Optional

# Own Imports
import agenta as ag
from agenta.sdk.decorators.base import BaseDecorator
from agenta.sdk.tracing.logger import llm_logger as logging
from agenta.sdk.tracing.tracing_context import tracing_context, TracingContext
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
        self, config: Optional[dict] = None, spankind: str = "workflow"
    ) -> None:
        self.config = config
        self.spankind = spankind
        self.tracing = ag.tracing

    def __call__(self, func: Callable[..., Any]):
        is_coroutine_function = inspect.iscoroutinefunction(func)

        @debug()
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            result = None
            func_args = inspect.getfullargspec(func).args
            input_dict = {name: value for name, value in zip(func_args, args)}
            input_dict.update(kwargs)

            async def wrapped_func(*args, **kwargs):
                # logging.debug(" ".join([">..", str(tracing_context.get())]))

                token = None
                if tracing_context.get() is None:
                    token = tracing_context.set(TracingContext())

                # logging.debug(" ".join([">>.", str(tracing_context.get())]))

                self.tracing.start_span(
                    name=func.__name__,
                    input=input_dict,
                    spankind=self.spankind,
                    config=self.config,
                )

                try:
                    result = await func(*args, **kwargs)

                    self.tracing.set_status(status="OK")
                    self.tracing.end_span(
                        outputs=(
                            {"message": result}
                            if not isinstance(result, dict)
                            else result
                        )
                    )

                    # logging.debug(" ".join(["<<.", str(tracing_context.get())]))

                    if token is not None:
                        tracing_context.reset(token)

                    # logging.debug(" ".join(["<..", str(tracing_context.get())]))

                    return result

                except Exception as e:
                    result = {
                        "message": str(e),
                        "stacktrace": traceback.format_exc(),
                    }

                    self.tracing.set_attributes(
                        {"traceback_exception": traceback.format_exc()}
                    )
                    self.tracing.set_status(status="ERROR")
                    self.tracing.end_span(outputs=result)

                    # logging.debug(" ".join(["<<.", str(tracing_context.get())]))

                    if token is not None:
                        tracing_context.reset(token)

                    # logging.debug(" ".join(["<..", str(tracing_context.get())]))

                    raise e

            return await wrapped_func(*args, **kwargs)

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            result = None
            func_args = inspect.getfullargspec(func).args
            input_dict = {name: value for name, value in zip(func_args, args)}
            input_dict.update(kwargs)

            def wrapped_func(*args, **kwargs):
                # logging.debug(" ".join([">..", str(tracing_context.get())]))

                token = None
                if tracing_context.get() is None:
                    token = tracing_context.set(TracingContext())

                # logging.debug(" ".join([">>.", str(tracing_context.get())]))

                span = self.tracing.start_span(
                    name=func.__name__,
                    input=input_dict,
                    spankind=self.spankind,
                    config=self.config,
                )

                try:
                    result = func(*args, **kwargs)

                    self.tracing.set_status(status="OK")
                    self.tracing.end_span(
                        outputs=(
                            {"message": result}
                            if not isinstance(result, dict)
                            else result
                        )
                    )

                    # logging.debug(" ".join(["<<.", str(tracing_context.get())]))

                    if token is not None:
                        tracing_context.reset(token)

                    # logging.debug(" ".join(["<..", str(tracing_context.get())]))

                    return result

                except Exception as e:
                    result = {
                        "message": str(e),
                        "stacktrace": traceback.format_exc(),
                    }

                    self.tracing.set_attributes(
                        {"traceback_exception": traceback.format_exc()}
                    )

                    self.tracing.set_status(status="ERROR")
                    self.tracing.end_span(outputs=result)

                    # logging.debug(" ".join(["<<.", str(tracing_context.get())]))

                    if token is not None:
                        tracing_context.reset(token)

                    # logging.debug(" ".join(["<..", str(tracing_context.get())]))

                    raise e

            return wrapped_func(*args, **kwargs)

        return async_wrapper if is_coroutine_function else sync_wrapper
