# Own Imports
from agenta.sdk import llm_tracing

# Third Party Imports
from litellm.utils import ModelResponse
from litellm.integrations.custom_logger import CustomLogger as LitellmCustomLogger


class AgentaLiteLLMHandler(LitellmCustomLogger):
    """This handler is responsible for logging certain events when using litellm to call LLMs.

    Args:
        LitellmCustomLogger (object): custom logger that allows us to override the events to capture.
    """

    @property
    def _trace(self):
        return llm_tracing()

    def log_pre_api_call(self, model, messages, kwargs):
        self._trace.start_span(
            name="pre_api_call",
            input=(
                {"messages": messages}
                if isinstance(messages, list)
                else {"inputs": messages}
            ),
            spankind=(
                "llm"
                if kwargs["call_type"] in ["completion", "acompletion"]
                else "unset"
            ),
        )
        self._trace.set_span_attribute(
            "model_config",
            {
                "model": kwargs.get("model"),
                "temperature": kwargs["optional_params"]["temperature"],
            },
        )

    def log_stream_event(self, kwargs, response_obj, start_time, end_time):
        self._trace.update_span_status(span=self._trace.active_span, value="OK")
        self._trace.end_span(
            outputs={
                "message": kwargs["complete_streaming_response"],
                "usage": kwargs["usage"],
                "cost": kwargs.get("response_cost"),
            },
            span=self._trace.active_span,
        )

    def log_success_event(
        self, kwargs, response_obj: ModelResponse, start_time, end_time
    ):
        self._trace.update_span_status(span=self._trace.active_span, value="OK")
        self._trace.end_span(
            outputs={
                "message": kwargs["message"],
                "usage": kwargs["usage"],
                "cost": kwargs.get("response_cost"),
            },
            span=self._trace.active_span,
        )

    def log_failure_event(
        self, kwargs, response_obj: ModelResponse, start_time, end_time
    ):
        self._trace.update_span_status(span=self._trace.active_span, value="ERROR")
        self._trace.set_span_attribute(
            attributes={
                "traceback_exception": kwargs["traceback_exception"],
                "call_end_time": kwargs["end_time"],
            },
        )
        self._trace.end_span(
            outputs={
                "message": kwargs["exception"],
                "usage": kwargs["usage"],
                "cost": kwargs.get("response_cost"),
            },
            span=self._trace.active_span,
        )

    async def async_log_stream_event(self, kwargs, response_obj, start_time, end_time):
        self._trace.update_span_status(span=self._trace.active_span, value="OK")
        self._trace.end_span(
            outputs={
                "message": kwargs["complete_streaming_response"],
                "usage": kwargs["usage"],
                "cost": kwargs.get("response_cost"),
            },
            span=self._trace.active_span,
        )

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        self._trace.update_span_status(span=self._trace.active_span, value="OK")
        self._trace.end_span(
            outputs={
                "message": kwargs["message"],
                "usage": kwargs["usage"],
                "cost": kwargs.get("response_cost"),
            },
            span=self._trace.active_span,
        )

    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):
        self._trace.update_span_status(span=self._trace.active_span, value="ERROR")
        self._trace.set_span_attribute(
            attributes={
                "traceback_exception": kwargs["traceback_exception"],
                "call_end_time": kwargs["end_time"],
            },
        )
        self._trace.end_span(
            outputs={
                "message": kwargs["exception"],
                "usage": kwargs["usage"],
                "cost": kwargs.get("response_cost"),
            },
            span=self._trace.active_span,
        )


agenta_litellm_handler = AgentaLiteLLMHandler()
