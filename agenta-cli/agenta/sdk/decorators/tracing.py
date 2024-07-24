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
        self,
        config: Optional[dict] = None,
        spankind: str = "workflow",
        block: Optional[str] = None,
    ) -> None:
        self.config = config
        self.spankind = spankind
        self.block = block if block is not None else spankind

    def __call__(self, func: Callable[..., Any]):
        is_coroutine_function = inspect.iscoroutinefunction(func)

        @debug()
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            func_args = inspect.getfullargspec(func).args
            input_dict = {name: value for name, value in zip(func_args, args)}
            input_dict.update(kwargs)

            async def wrapped_func(*args, **kwargs):
                token = None

                if tracing_context.get() is None:
                    token = tracing_context.set(TracingContext())

                ag.tracing.start_span(
                    name=func.__name__,
                    input=input_dict,
                    spankind=self.spankind,
                    config=self.config,
                )  # missing attributes on creation
                ag.tracing.set_attributes({"block": self.block})

                result = None
                error = None

                try:
                    result = await func(*args, **kwargs)
                except Exception as e:
                    logging.error(e)

                    result = {
                        "message": str(e),
                        "stacktrace": traceback.format_exc(),
                    }
                    error = e

                if error:
                    # This will evolve as be work towards OTel compliance
                    ag.tracing.set_attributes(
                        {"traceback_exception": traceback.format_exc()}
                    )
                    ag.tracing.set_status(status="ERROR")

                # This will evolve as we work on the CreateSpan schema
                ag.tracing.end_span(
                    outputs=(
                        {"message": result} if not isinstance(result, dict) else result
                    )
                )

                if token is not None:
                    # This only runs when using @instrument without @entrypoint/@route
                    ag.tracing.flush_spans()
                    tracing_context.reset(token)

                if error:
                    raise error

                return result

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

                ag.tracing.start_span(
                    name=func.__name__,
                    input=input_dict,
                    spankind=self.spankind,
                    config=self.config,
                )

                try:
                    result = func(*args, **kwargs)

                    ag.tracing.set_status(status="OK")
                    ag.tracing.end_span(
                        outputs=(
                            {"message": result}
                            if not isinstance(result, dict)
                            else result
                        )
                    )

                    # logging.debug(" ".join(["<<.", str(tracing_context.get())]))

                    if token is not None:
                        ag.tracing.flush_spans()
                        tracing_context.reset(token)

                    # logging.debug(" ".join(["<..", str(tracing_context.get())]))

                    return result

                except Exception as e:
                    result = {
                        "message": str(e),
                        "stacktrace": traceback.format_exc(),
                    }

                    ag.tracing.set_attributes(
                        {"traceback_exception": traceback.format_exc()}
                    )

                    ag.tracing.set_status(status="ERROR")
                    ag.tracing.end_span(outputs=result)

                    # logging.debug(" ".join(["<<.", str(tracing_context.get())]))

                    if token is not None:
                        ag.tracing.flush_spans()
                        tracing_context.reset(token)

                    # logging.debug(" ".join(["<..", str(tracing_context.get())]))

                    raise e

            return wrapped_func(*args, **kwargs)

        return async_wrapper if is_coroutine_function else sync_wrapper
