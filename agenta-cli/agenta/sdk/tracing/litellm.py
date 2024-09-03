import agenta as ag


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
            kind = (
                "GENERATION"
                if kwargs.get("call_type") in ["completion", "acompletion"]
                else "EMBEDDING"
            )

            self.span = ag.tracing.start_span(name=f"litellm_{kind.lower()}", kind=kind)

            if not self.span:
                ag.logging.error("LiteLLM callback error: span not found.")
                return

            # ag.logging.info(f"log_pre_api_call({hex(self.span.context.span_id)[2:]})")

            ag.tracing.set_attributes(
                namespace="data.inputs",
                attributes={"messages": kwargs["messages"]},
                span=self.span,
            )

            ag.tracing.set_attributes(
                namespace="metadata.config",
                attributes={
                    "model": kwargs.get("model"),
                    **kwargs.get("optional_params"),
                },
                span=self.span,
            )

        def log_stream_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            if not self.span:
                ag.logging.error("LiteLLM callback error: span not found.")
                return

            # ag.logging.info(f"log_stream({hex(self.span.context.span_id)[2:]})")

            ag.tracing.set_attributes(
                namespace="data.outputs",
                attributes={"__default__": kwargs.get("complete_streaming_response")},
                span=self.span,
            )

            ag.tracing.set_attributes(
                namespace="metrics.costs",
                attributes={"marginal": kwargs.get("response_cost")},
                span=self.span,
            )

            ag.tracing.set_attributes(
                namespace="metrics.tokens",
                attributes=(
                    {
                        "prompt": response_obj.usage.prompt_tokens,
                        "completion": response_obj.usage.completion_tokens,
                        "total": response_obj.usage.total_tokens,
                    }
                ),
                span=self.span,
            )

            ag.tracing.set_status(status="OK", span=self.span)

            self.span.end()

        def log_success_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            if not self.span:
                ag.logging.error("LiteLLM callback error: span not found.")
                return

            # ag.logging.info(f"log_success({hex(self.span.context.span_id)[2:]})")

            ag.tracing.set_attributes(
                namespace="data.outputs",
                attributes={"__default__": response_obj.choices[0].message.content},
                span=self.span,
            )

            ag.tracing.set_attributes(
                namespace="metrics.costs",
                attributes={"marginal": kwargs.get("response_cost")},
                span=self.span,
            )

            ag.tracing.set_attributes(
                namespace="metrics.tokens",
                attributes=(
                    {
                        "prompt": response_obj.usage.prompt_tokens,
                        "completion": response_obj.usage.completion_tokens,
                        "total": response_obj.usage.total_tokens,
                    }
                ),
                span=self.span,
            )

            ag.tracing.set_status(status="OK", span=self.span)

            self.span.end()

        def log_failure_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            if not self.span:
                ag.logging.error("LiteLLM callback error: span not found.")
                return

            # ag.logging.info(f"log_failure({hex(self.span.context.span_id)[2:]})")

            ag.tracing.record_exception(kwargs["exception"], span=self.span)

            ag.tracing.set_status(status="ERROR", span=self.span)

            self.span.end()

        async def async_log_stream_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            if not self.span:
                ag.logging.error("LiteLLM callback error: span not found.")
                return

            # ag.logging.info(f"async_log_stream({hex(self.span.context.span_id)[2:]})")

            ag.tracing.set_attributes(
                namespace="data.outputs",
                attributes={"__default__": kwargs.get("complete_streaming_response")},
                span=self.span,
            )

            ag.tracing.set_attributes(
                namespace="metrics.costs",
                attributes={"marginal": kwargs.get("response_cost")},
                span=self.span,
            )

            ag.tracing.set_attributes(
                namespace="metrics.tokens",
                attributes=(
                    {
                        "prompt": response_obj.usage.prompt_tokens,
                        "completion": response_obj.usage.completion_tokens,
                        "total": response_obj.usage.total_tokens,
                    }
                ),
                span=self.span,
            )

            ag.tracing.set_status(status="OK", span=self.span)

            self.span.end()

        async def async_log_success_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            if not self.span:
                ag.logging.error("LiteLLM callback error: span not found.")
                return

            # ag.logging.info(f"async_log_success({hex(self.span.context.span_id)[2:]})")

            ag.tracing.set_attributes(
                namespace="data.outputs",
                attributes={"__default__": response_obj.choices[0].message.content},
                span=self.span,
            )

            ag.tracing.set_attributes(
                namespace="metrics.costs",
                attributes={"marginal": kwargs.get("response_cost")},
                span=self.span,
            )

            ag.tracing.set_attributes(
                namespace="metrics.tokens",
                attributes=(
                    {
                        "prompt": response_obj.usage.prompt_tokens,
                        "completion": response_obj.usage.completion_tokens,
                        "total": response_obj.usage.total_tokens,
                    }
                ),
                span=self.span,
            )

            ag.tracing.set_status(status="OK", span=self.span)

            self.span.end()

        async def async_log_failure_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            if not self.span:
                ag.logging.error("LiteLLM callback error: span not found.")
                return

            # ag.logging.info(f"async_log_failure({hex(self.span.context.span_id)[2:]})")

            ag.tracing.record_exception(kwargs["exception"], span=self.span)

            ag.tracing.set_status(status="ERROR", span=self.span)

            self.span.end()

    return LitellmHandler()
