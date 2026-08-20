import warnings
from typing import Any, Dict, Optional
from opentelemetry.trace import SpanKind

import agenta as ag

from agenta.sdk.engines.tracing.spans import CustomSpan
from agenta.sdk.utils.logging import get_module_logger

log = get_module_logger(__name__)


def _read(source: Any, key: str) -> Any:
    """Read ``key`` off a usage payload that may arrive as a dict or as an object."""
    if source is None:
        return None
    if isinstance(source, dict):
        return source.get(key)
    return getattr(source, key, None)


def _extract_token_usage(response_obj: Any) -> Dict[str, Optional[float]]:
    """The token counts recorded under ``metrics.unit.tokens`` for one LLM call.

    ``cache_read`` is the slice of the prompt the provider served from its cache, which
    prices far below fresh input. It is a SUBSET of ``prompt_tokens``, not an addition to
    it, so it is recorded alongside the prompt total and never deducted from it; the
    cost calculation re-prices that slice at the cached rate.
    """
    usage = _read(response_obj, "usage")

    prompt_tokens = _read(usage, "prompt_tokens")
    completion_tokens = _read(usage, "completion_tokens")
    total_tokens = _read(usage, "total_tokens")

    # OpenAI and Google both report the cached count at
    # ``prompt_tokens_details.cached_tokens``; Anthropic-style usage surfaces it flat as
    # ``cache_read_input_tokens``. Check the nested form first: on a provider that reports
    # both, the nested one is the OpenAI-convention value matching ``prompt_tokens``.
    cache_read_tokens = _read(_read(usage, "prompt_tokens_details"), "cached_tokens")
    if cache_read_tokens is None:
        cache_read_tokens = _read(usage, "cache_read_input_tokens")

    # Falsy -> None throughout, matching how prompt/completion/total have always been
    # recorded: a zero carries no more information than an absent field here.
    return {
        "prompt": float(prompt_tokens) if prompt_tokens else None,
        "completion": float(completion_tokens) if completion_tokens else None,
        "total": float(total_tokens) if total_tokens else None,
        "cache_read": float(cache_read_tokens) if cache_read_tokens else None,
    }


def litellm_handler():
    if ag.tracing is None:
        warnings.warn(
            "ag.callbacks.litellm_handler() called before ag.init(). "
            "Tracing will be disabled. Call ag.init() before setting up litellm callbacks.",
            RuntimeWarning,
            stacklevel=2,
        )

    try:
        from litellm.integrations.custom_logger import (  # pylint: disable=import-outside-toplevel
            CustomLogger as LitellmCustomLogger,
        )
    except ImportError as exc:
        raise ImportError(
            "The litellm SDK is not installed. Please install it using `pip install litellm`."
        ) from exc
    except Exception as exc:
        raise Exception(  # pylint: disable=broad-exception-raised
            f"Unexpected error occurred when importing litellm: {exc}"
        ) from exc

    class LitellmHandler(LitellmCustomLogger):
        """
        This handler is responsible for instrumenting certain events,
        when using litellm to call LLMs.

        Args:
            LitellmCustomLogger (object): custom logger that allows us
            to override the events to capture.
        """

        def __init__(self):
            super().__init__()

            self.span: Dict[str, CustomSpan] = dict()

        def log_pre_api_call(
            self,
            model,
            messages,
            kwargs,
        ):
            litellm_call_id = kwargs.get("litellm_call_id")

            if not litellm_call_id:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            type = (  # pylint: disable=redefined-builtin
                "chat"
                if kwargs.get("call_type") in ["completion", "acompletion"]
                else "embedding"
            )

            kind = SpanKind.CLIENT

            self.span[litellm_call_id] = CustomSpan(
                ag.tracer.start_span(name=f"litellm_{kind.name.lower()}", kind=kind)
            )

            span = self.span[litellm_call_id]

            if not span:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            if not span.is_recording():
                log.error("Agenta SDK - litellm span not recording.")
                return

            span.set_attributes(
                attributes={"node": type},
                namespace="type",
            )

            span.set_attributes(
                attributes={"inputs": {"prompt": kwargs["messages"]}},
                namespace="data",
            )

            span.set_attributes(
                attributes={
                    "configuration": {
                        "model": kwargs.get("model"),
                        **kwargs.get("optional_params"),
                    }
                },
                namespace="meta",
            )

        def log_stream_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            litellm_call_id = kwargs.get("litellm_call_id")

            if not litellm_call_id:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            span = self.span[litellm_call_id]

            if not span:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            if not span.is_recording():
                return

        def log_success_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            if kwargs.get("stream"):
                return

            litellm_call_id = kwargs.get("litellm_call_id")

            if not litellm_call_id:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            span = self.span[litellm_call_id]

            if not span:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            if not span.is_recording():
                return

            try:
                result = []
                for choice in response_obj.choices:
                    message = choice.message.__dict__
                    result.append(message)

                outputs = {"completion": result}
                span.set_attributes(
                    attributes={"outputs": outputs},
                    namespace="data",
                )

            except Exception:
                pass

            span.set_attributes(
                attributes={
                    "total": (
                        float(kwargs.get("response_cost"))
                        if kwargs.get("response_cost")
                        else None
                    )
                },
                namespace="metrics.unit.costs",
            )

            span.set_attributes(
                attributes=_extract_token_usage(response_obj),
                namespace="metrics.unit.tokens",
            )

            span.set_status(status="OK")

            span.end()

            # Clean up span from dictionary to prevent memory leak
            del self.span[litellm_call_id]

        def log_failure_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            litellm_call_id = kwargs.get("litellm_call_id")

            if not litellm_call_id:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            span = self.span[litellm_call_id]

            if not span:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            if not span.is_recording():
                return

            span.record_exception(kwargs["exception"])

            span.set_status(status="ERROR")

            span.end()

            # Clean up span from dictionary to prevent memory leak
            del self.span[litellm_call_id]

        async def async_log_stream_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            if kwargs.get("stream"):
                return

            litellm_call_id = kwargs.get("litellm_call_id")

            if not litellm_call_id:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            span = self.span[litellm_call_id]

            if not span:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            if not span.is_recording():
                return

        async def async_log_success_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            litellm_call_id = kwargs.get("litellm_call_id")

            if not litellm_call_id:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            span = self.span[litellm_call_id]

            if not span:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            if not span.is_recording():
                return

            try:
                result = []
                for choice in response_obj.choices:
                    message = choice.message.__dict__
                    result.append(message)

                outputs = {"completion": result}
                span.set_attributes(
                    attributes={"outputs": outputs},
                    namespace="data",
                )

            except Exception:
                pass

            span.set_attributes(
                attributes={
                    "total": (
                        float(kwargs.get("response_cost"))
                        if kwargs.get("response_cost")
                        else None
                    )
                },
                namespace="metrics.unit.costs",
            )

            span.set_attributes(
                attributes=_extract_token_usage(response_obj),
                namespace="metrics.unit.tokens",
            )

            span.set_status(status="OK")

            span.end()

            # Clean up span from dictionary to prevent memory leak
            del self.span[litellm_call_id]

        async def async_log_failure_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            litellm_call_id = kwargs.get("litellm_call_id")

            if not litellm_call_id:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            span = self.span[litellm_call_id]

            if not span:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            if not span.is_recording():
                return

            span.record_exception(kwargs["exception"])

            span.set_status(status="ERROR")

            span.end()

            # Clean up span from dictionary to prevent memory leak
            del self.span[litellm_call_id]

    return LitellmHandler()
