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

        @property
        def _trace(self):
            return ag.tracing

        def log_pre_api_call(self, model, messages, kwargs):
            self._trace.start_span(
                name=kwargs["litellm_params"][
                    "litellm_call_id"
                ],  # make use of the litellm_call_id as the span name
                input=kwargs["input"],
                spankind=(
                    "llm"
                    if kwargs.get("call_type") in ["completion", "acompletion"]
                    else (
                        "embedding"
                        if kwargs.get("call_type") in ["embedding", "aembedding"]
                        else "unset"
                    )
                ),
            )
            self._trace.set_span_attribute(
                {
                    "model_config": {
                        "model": kwargs.get("model"),
                        **kwargs.get(
                            "optional_params"
                        ),  # model-specific params passed in
                    },
                }
            )

        def log_stream_event(self, kwargs, response_obj, start_time, end_time):
            self._trace.update_span_status(span=self._trace.active_span, value="OK")
            self._trace.end_span(
                outputs={
                    "message": kwargs.get(
                        "complete_streaming_response"
                    ),  # the complete streamed response (only set if `completion(..stream=True)`)
                    "usage": kwargs.get("usage"),  # litellm calculates usage
                    "cost": kwargs.get(
                        "response_cost"
                    ),  # litellm calculates response cost
                },
            )

        def log_success_event(
            self, kwargs, response_obj: ModelResponse, start_time, end_time
        ):
            self._trace.update_span_status(span=self._trace.active_span, value="OK")
            self._trace.end_span(
                outputs={
                    "message": response_obj.choices[0].message.content,
                    "usage": kwargs.get("usage"),  # litellm calculates usage
                    "cost": kwargs.get(
                        "response_cost"
                    ),  # litellm calculates response cost
                },
            )

        def log_failure_event(
            self, kwargs, response_obj: ModelResponse, start_time, end_time
        ):
            self._trace.update_span_status(span=self._trace.active_span, value="ERROR")
            self._trace.set_span_attribute(
                attributes={
                    "traceback_exception": kwargs[
                        "traceback_exception"
                    ],  # the traceback generated via `traceback.format_exc()`
                    "call_end_time": kwargs[
                        "end_time"
                    ],  # datetime object of when call was completed
                },
            )
            self._trace.end_span(
                outputs={
                    "message": kwargs["exception"],  # the Exception raised
                    "usage": kwargs.get("usage"),  # litellm calculates usage
                    "cost": kwargs.get(
                        "response_cost"
                    ),  # litellm calculates response cost
                },
            )

        async def async_log_stream_event(
            self, kwargs, response_obj, start_time, end_time
        ):
            self._trace.update_span_status(span=self._trace.active_span, value="OK")
            self._trace.end_span(
                outputs={
                    "message": kwargs.get(
                        "complete_streaming_response"
                    ),  # the complete streamed response (only set if `completion(..stream=True)`)
                    "usage": kwargs.get("usage"),  # litellm calculates usage
                    "cost": kwargs.get(
                        "response_cost"
                    ),  # litellm calculates response cost
                },
            )

        async def async_log_success_event(
            self, kwargs, response_obj, start_time, end_time
        ):
            self._trace.update_span_status(span=self._trace.active_span, value="OK")
            self._trace.end_span(
                outputs={
                    "message": response_obj.choices[0].message.content,
                    "usage": kwargs.get("usage"),  # litellm calculates usage
                    "cost": kwargs.get(
                        "response_cost"
                    ),  # litellm calculates response cost
                },
            )

        async def async_log_failure_event(
            self, kwargs, response_obj, start_time, end_time
        ):
            self._trace.update_span_status(span=self._trace.active_span, value="ERROR")
            self._trace.set_span_attribute(
                attributes={
                    "traceback_exception": kwargs[
                        "traceback_exception"
                    ],  # the traceback generated via `traceback.format_exc()`
                    "call_end_time": kwargs[
                        "end_time"
                    ],  # datetime object of when call was completed
                },
            )
            self._trace.end_span(
                outputs={
                    "message": kwargs["exception"],  # the Exception raised
                    "usage": kwargs.get("usage"),  # litellm calculates usage
                    "cost": kwargs.get(
                        "response_cost"
                    ),  # litellm calculates response cost
                },
            )

    return LitellmHandler()
