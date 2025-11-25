from typing import Dict
from opentelemetry.trace import SpanKind

import agenta as ag

from agenta.sdk.tracing.spans import CustomSpan
from agenta.sdk.utils.exceptions import suppress  # TODO: use it !
from agenta.sdk.utils.logging import get_module_logger

log = get_module_logger(__name__)


def litellm_handler():
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

            except Exception as e:
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
                attributes=(
                    {
                        "prompt": (
                            float(response_obj.usage.prompt_tokens)
                            if response_obj.usage.prompt_tokens
                            else None
                        ),
                        "completion": (
                            float(response_obj.usage.completion_tokens)
                            if response_obj.usage.completion_tokens
                            else None
                        ),
                        "total": (
                            float(response_obj.usage.total_tokens)
                            if response_obj.usage.total_tokens
                            else None
                        ),
                    }
                ),
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

            except Exception as e:
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
                attributes=(
                    {
                        "prompt": (
                            float(response_obj.usage.prompt_tokens)
                            if response_obj.usage.prompt_tokens
                            else None
                        ),
                        "completion": (
                            float(response_obj.usage.completion_tokens)
                            if response_obj.usage.completion_tokens
                            else None
                        ),
                        "total": (
                            float(response_obj.usage.total_tokens)
                            if response_obj.usage.total_tokens
                            else None
                        ),
                    }
                ),
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
