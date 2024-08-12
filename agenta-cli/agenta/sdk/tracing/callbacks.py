import agenta as ag

from agenta.sdk.tracing.tracing_context import tracing_context, TracingContext
from agenta.sdk.tracing.logger import llm_logger as logging

from agenta.sdk.utils.debug import debug

TRACE_DEFAULT_KEY = "__default__"


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

        @property
        def _trace(self):
            return ag.tracing

        @debug()
        def log_pre_api_call(self, model, messages, kwargs):
            call_type = kwargs.get("call_type")
            span_kind = (
                "llm" if call_type in ["completion", "acompletion"] else "embedding"
            )

            self.span = ag.tracing.open_span(
                name=f"{span_kind}_call",
                input={"messages": kwargs["messages"]},
                spankind=span_kind,
                active=False,
            )
            logging.info(f"log_pre_api_call({self.span.id})")
            ag.tracing.set_attributes(
                {
                    "model_config": {
                        "model": kwargs.get("model"),
                        **kwargs.get(
                            "optional_params"
                        ),  # model-specific params passed in
                    },
                }
            )

        @debug()
        def log_stream_event(self, kwargs, response_obj, start_time, end_time):
            logging.info(f"log_stream_event({self.span.id})")
            ag.tracing.set_status(status="OK", span_id=self.span.id)
            ag.tracing.store_cost(kwargs.get("response_cost"), span_id=self.span.id)
            ag.tracing.store_usage(
                response_obj.usage.dict() if hasattr(response_obj, "usage") else None,
                span_id=self.span.id,
            )
            ag.tracing.store_outputs(
                # the complete streamed response (only set if `completion(..stream=True)`
                outputs={TRACE_DEFAULT_KEY: kwargs.get("complete_streaming_response")},
                span_id=self.span.id,
            )
            ag.tracing.close_span(span_id=self.span.id)

        @debug()
        def log_success_event(self, kwargs, response_obj, start_time, end_time):
            logging.info(f"log_success_event({self.span.id})")
            ag.tracing.set_status(status="OK", span_id=self.span.id)
            ag.tracing.store_cost(kwargs.get("response_cost"), span_id=self.span.id)
            ag.tracing.store_usage(
                response_obj.usage.dict() if hasattr(response_obj, "usage") else None,
                span_id=self.span.id,
            )
            ag.tracing.store_outputs(
                outputs={TRACE_DEFAULT_KEY: response_obj.choices[0].message.content},
                span_id=self.span.id,
            )
            ag.tracing.close_span(span_id=self.span.id)

        @debug()
        def log_failure_event(self, kwargs, response_obj, start_time, end_time):
            logging.info("log_failure_event()", self.span)
            ag.tracing.set_status(status="ERROR", span_id=self.span.id)
            ag.tracing.set_attributes(
                {
                    "traceback_exception": repr(
                        kwargs["traceback_exception"]
                    ),  # the traceback generated via `traceback.format_exc()`
                    "call_end_time": kwargs[
                        "end_time"
                    ],  # datetime object of when call was completed
                },
                span_id=self.span.id,
            )
            ag.tracing.store_cost(kwargs.get("response_cost"), span_id=self.span.id)
            ag.tracing.store_usage(
                response_obj.usage.dict() if hasattr(response_obj, "usage") else None,
                span_id=self.span.id,
            )
            ag.tracing.store_outputs(
                # the Exception raised
                outputs={TRACE_DEFAULT_KEY: repr(kwargs["exception"])},
                span_id=self.span.id,
            )
            ag.tracing.close_span(span_id=self.span.id)

        @debug()
        async def async_log_stream_event(
            self, kwargs, response_obj, start_time, end_time
        ):
            logging.info(f"async_log_stream_event({self.span.id})")
            ag.tracing.set_status(status="OK", span_id=self.span.id)
            ag.tracing.store_cost(kwargs.get("response_cost"), span_id=self.span.id)
            ag.tracing.store_usage(
                response_obj.usage.dict() if hasattr(response_obj, "usage") else None,
                span_id=self.span.id,
            )
            ag.tracing.store_outputs(
                # the complete streamed response (only set if `completion(..stream=True)`)
                outputs={TRACE_DEFAULT_KEY: kwargs.get("complete_streaming_response")},
                span_id=self.span.id,
            )
            ag.tracing.close_span(span_id=self.span.id)

        @debug()
        async def async_log_success_event(
            self, kwargs, response_obj, start_time, end_time
        ):
            logging.info(f"async_log_success_event({self.span.id})")
            ag.tracing.set_status(status="OK", span_id=self.span.id)
            ag.tracing.store_cost(kwargs.get("response_cost"), span_id=self.span.id)
            ag.tracing.store_usage(
                response_obj.usage.dict() if hasattr(response_obj, "usage") else None,
                span_id=self.span.id,
            )
            ag.tracing.store_outputs(
                outputs={TRACE_DEFAULT_KEY: response_obj.choices[0].message.content},
                span_id=self.span.id,
            )
            ag.tracing.close_span(span_id=self.span.id)

        @debug()
        async def async_log_failure_event(
            self, kwargs, response_obj, start_time, end_time
        ):
            logging.info(f"async_log_failure_event({self.span.id})")
            ag.tracing.set_status(status="ERROR", span_id=self.span.id)
            ag.tracing.set_attributes(
                {
                    "traceback_exception": kwargs[
                        "traceback_exception"
                    ],  # the traceback generated via `traceback.format_exc()`
                    "call_end_time": kwargs[
                        "end_time"
                    ],  # datetime object of when call was completed
                },
                span_id=self.span.id,
            )
            ag.tracing.store_cost(kwargs.get("response_cost"), span_id=self.span.id)
            ag.tracing.store_usage(
                response_obj.usage.dict() if hasattr(response_obj, "usage") else None,
                span_id=self.span.id,
            )
            ag.tracing.store_outputs(
                # the Exception raised
                outputs={TRACE_DEFAULT_KEY: repr(kwargs["exception"])},
                span_id=self.span.id,
            )
            ag.tracing.close_span(span_id=self.span.id)

    return LitellmHandler()
