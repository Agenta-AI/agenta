import agenta as ag

from agenta.sdk.tracing.spans import CustomSpan
from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.utils.logging import log


def litellm_handler():
    try:
        from litellm.utils import ModelResponse
        from litellm.integrations.custom_logger import (
            CustomLogger as LitellmCustomLogger,
        )
    except ImportError as exc:
        raise ImportError(
            "The litellm SDK is not installed. Please install it using `pip install litellm`."
        ) from exc
    except Exception as exc:
        raise Exception(
            "Unexpected error occurred when importing litellm: {}".format(exc)
        ) from exc

    class LitellmHandler(LitellmCustomLogger):
        """This handler is responsible for instrumenting certain events when using litellm to call LLMs.

        Args:
            LitellmCustomLogger (object): custom logger that allows us to override the events to capture.
        """

        def __init__(self):
            self.span = None

        def log_pre_api_call(
            self,
            model,
            messages,
            kwargs,
        ):
            type = (
                "chat"
                if kwargs.get("call_type") in ["completion", "acompletion"]
                else "embedding"
            )

            kind = "CLIENT"

            self.span = CustomSpan(
                ag.tracer.start_span(name=f"litellm_{kind.lower()}", kind=kind)
            )

            self.span.set_attributes(
                attributes={"node": type},
                namespace="type",
            )

            if not self.span:
                log.error("LiteLLM callback error: span not found.")
                return

            log.info(f"log_pre_api_call({hex(self.span.context.span_id)[2:]})")

            self.span.set_attributes(
                attributes={"inputs": {"messages": kwargs["messages"]}},
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

            # log.info(f"log_stream({hex(self.span.context.span_id)[2:]})")

            self.span.set_attributes(
                attributes={
                    "output": {"__default__": kwargs.get("complete_streaming_response")}
                },
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

            # log.info(f"log_success({hex(self.span.context.span_id)[2:]})")

            self.span.set_attributes(
                attributes={
                    "output": {"__default__": response_obj.choices[0].message.content}
                },
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

            # log.info(f"log_failure({hex(self.span.context.span_id)[2:]})")

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

            # log.info(f"async_log_stream({hex(self.span.context.span_id)[2:]})")

            self.span.set_attributes(
                attributes={
                    "output": {"__default__": kwargs.get("complete_streaming_response")}
                },
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

            log.info(f"async_log_success({hex(self.span.context.span_id)[2:]})")

            self.span.set_attributes(
                attributes={
                    "output": {"__default__": kwargs.get("complete_streaming_response")}
                },
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

            # log.info(f"async_log_failure({hex(self.span.context.span_id)[2:]})")

            self.span.record_exception(kwargs["exception"])

            self.span.set_status(status="ERROR")

            self.span.end()

    return LitellmHandler()
