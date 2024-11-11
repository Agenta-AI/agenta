from opentelemetry.trace import SpanKind

import agenta as ag

from agenta.sdk.tracing.spans import CustomSpan
from agenta.sdk.utils.exceptions import suppress  # TODO: use it !
from agenta.sdk.utils.logging import log


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

            self.span = None

        def log_pre_api_call(
            self,
            model,
            messages,
            kwargs,
        ):
            type = (  # pylint: disable=redefined-builtin
                "chat"
                if kwargs.get("call_type") in ["completion", "acompletion"]
                else "embedding"
            )

            kind = SpanKind.CLIENT

            self.span = CustomSpan(
                ag.tracer.start_span(name=f"litellm_{kind.name.lower()}", kind=kind)
            )

            self.span.set_attributes(
                attributes={"node": type},
                namespace="type",
            )

            if not self.span:
                log.error("LiteLLM callback error: span not found.")
                return

            self.span.set_attributes(
                attributes={"inputs": {"prompt": kwargs["messages"]}},
                namespace="data",
            )

            self.span.set_attributes(
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
            if not self.span:
                log.error("LiteLLM callback error: span not found.")
                return

            result = kwargs.get("complete_streaming_response")

            outputs = (
                {"__default__": result} if not isinstance(result, dict) else result
            )

            self.span.set_attributes(
                attributes={"outputs": outputs},
                namespace="data",
            )

            self.span.set_attributes(
                attributes={"total": kwargs.get("response_cost")},
                namespace="metrics.unit.costs",
            )

            self.span.set_attributes(
                attributes=(
                    {
                        "prompt": response_obj.usage.prompt_tokens,
                        "completion": response_obj.usage.completion_tokens,
                        "total": response_obj.usage.total_tokens,
                    }
                ),
                namespace="metrics.unit.tokens",
            )

            self.span.set_status(status="OK")

            self.span.end()

        def log_success_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            if not self.span:
                log.error("LiteLLM callback error: span not found.")
                return

            try:
                result = []
                for choice in response_obj.choices:
                    message = choice.message.__dict__
                    result.append(message)

                outputs = {"completion": result}
                self.span.set_attributes(
                    attributes={"outputs": outputs},
                    namespace="data",
                )

            except Exception as e:
                pass

            self.span.set_attributes(
                attributes={"total": kwargs.get("response_cost")},
                namespace="metrics.unit.costs",
            )

            self.span.set_attributes(
                attributes=(
                    {
                        "prompt": response_obj.usage.prompt_tokens,
                        "completion": response_obj.usage.completion_tokens,
                        "total": response_obj.usage.total_tokens,
                    }
                ),
                namespace="metrics.unit.tokens",
            )

            self.span.set_status(status="OK")

            self.span.end()

        def log_failure_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            if not self.span:
                log.error("LiteLLM callback error: span not found.")
                return

            self.span.record_exception(kwargs["exception"])

            self.span.set_status(status="ERROR")

            self.span.end()

        async def async_log_stream_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            if not self.span:
                log.error("LiteLLM callback error: span not found.")
                return

            result = kwargs.get("complete_streaming_response")

            outputs = (
                {"__default__": result} if not isinstance(result, dict) else result
            )

            self.span.set_attributes(
                attributes={"outputs": outputs},
                namespace="data",
            )

            self.span.set_attributes(
                attributes={"total": kwargs.get("response_cost")},
                namespace="metrics.unit.costs",
            )

            self.span.set_attributes(
                attributes=(
                    {
                        "prompt": response_obj.usage.prompt_tokens,
                        "completion": response_obj.usage.completion_tokens,
                        "total": response_obj.usage.total_tokens,
                    }
                ),
                namespace="metrics.unit.tokens",
            )

            self.span.set_status(status="OK")

            self.span.end()

        async def async_log_success_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            if not self.span:
                log.error("LiteLLM callback error: span not found.")
                return

            # result = kwargs.get("complete_streaming_response")
            result = response_obj.choices[0].message.content

            outputs = (
                {"__default__": result} if not isinstance(result, dict) else result
            )

            self.span.set_attributes(
                attributes={"outputs": outputs},
                namespace="data",
            )

            self.span.set_attributes(
                attributes={"total": kwargs.get("response_cost")},
                namespace="metrics.unit.costs",
            )

            self.span.set_attributes(
                attributes=(
                    {
                        "prompt": response_obj.usage.prompt_tokens,
                        "completion": response_obj.usage.completion_tokens,
                        "total": response_obj.usage.total_tokens,
                    }
                ),
                namespace="metrics.unit.tokens",
            )

            self.span.set_status(status="OK")

            self.span.end()

        async def async_log_failure_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            if not self.span:
                log.error("LiteLLM callback error: span not found.")
                return

            self.span.record_exception(kwargs["exception"])

            self.span.set_status(status="ERROR")

            self.span.end()

    return LitellmHandler()
