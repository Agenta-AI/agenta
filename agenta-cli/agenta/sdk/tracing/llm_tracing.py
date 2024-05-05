# Stdlib Imports
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List, Union

# Own Imports
from agenta.sdk.tracing.logger import llm_logger
from agenta.sdk.tracing.tasks_manager import TaskQueue
from agenta.client.backend.client import AsyncAgentaApi
from agenta.client.backend.client import AsyncObservabilityClient
from agenta.client.backend.types.create_span import CreateSpan, SpanKind, SpanStatusCode

# Third Party Imports
from bson.objectid import ObjectId


class Tracing(object):
    """Agenta llm tracing object.

    Args:
        base_url (str): The URL of the backend host
        api_key (str): The API Key of the backend host
        tasks_manager (TaskQueue): The tasks manager dedicated to handling asynchronous tasks
        llm_logger (Logger): The logger associated with the LLM tracing
        max_workers (int): The maximum number of workers to run tracing
    """

    _instance = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(
        self,
        base_url: str,
        app_id: str,
        variant_id: str,
        variant_name: Optional[str] = None,
        api_key: Optional[str] = None,
        max_workers: Optional[int] = None,
    ):
        self.base_url = base_url + "/api"
        self.api_key = api_key if api_key is not None else ""
        self.llm_logger = llm_logger
        self.app_id = app_id
        self.variant_id = variant_id
        self.variant_name = variant_name
        self.tasks_manager = TaskQueue(
            max_workers if max_workers else 4, logger=llm_logger
        )
        self.active_span = CreateSpan
        self.active_trace = CreateSpan
        self.recording_trace_id: Union[str, None] = None
        self.recorded_spans: List[CreateSpan] = []
        self.tags: List[str] = []
        self.span_dict: Dict[str, CreateSpan] = {}  # type: ignore

    @property
    def client(self) -> AsyncObservabilityClient:
        """Initialize observability async client

        Returns:
            AsyncObservabilityClient: async client
        """

        return AsyncAgentaApi(
            base_url=self.base_url, api_key=self.api_key, timeout=120  # type: ignore
        ).observability

    def set_span_attribute(
        self, parent_key: Optional[str] = None, attributes: Dict[str, Any] = {}
    ):
        span = self.span_dict[self.active_span.id]  # type: ignore
        for key, value in attributes.items():
            self.set_attribute(span.attributes, key, value, parent_key)  # type: ignore

    def set_attribute(
        self,
        span_attributes: Dict[str, Any],
        key: str,
        value: Any,
        parent_key: Optional[str] = None,
    ):
        if parent_key is not None:
            model_config = span_attributes.get(parent_key, None)
            if not model_config:
                span_attributes[parent_key] = {}
            span_attributes[parent_key][key] = value
        else:
            span_attributes[key] = value

    def set_trace_tags(self, tags: List[str]):
        self.tags.extend(tags)

    def start_parent_span(
        self, name: str, inputs: Dict[str, Any], config: Dict[str, Any], **kwargs
    ):
        trace_id = self._create_trace_id()
        span_id = self._create_span_id()
        self.llm_logger.info("Recording parent span...")
        span = CreateSpan(
            id=span_id,
            app_id=self.app_id,
            variant_id=self.variant_id,
            variant_name=self.variant_name,
            inputs=inputs,
            name=name,
            config=config,
            environment=kwargs.get("environment"),
            spankind=SpanKind.WORKFLOW.value,
            status=SpanStatusCode.UNSET.value,
            start_time=datetime.now(timezone.utc),
        )
        self.active_trace = span
        self.recording_trace_id = trace_id
        self.parent_span_id = span.id
        self.llm_logger.info(
            f"Recorded active_trace and setting parent_span_id: {span.id}"
        )

    def start_span(
        self,
        name: str,
        spankind: str,
        input: Dict[str, Any],
        config: Dict[str, Any] = {},
    ) -> CreateSpan:
        span_id = self._create_span_id()
        self.llm_logger.info(f"Recording {spankind} span...")
        span = CreateSpan(
            id=span_id,
            inputs=input,
            name=name,
            app_id=self.app_id,
            variant_id=self.variant_id,
            variant_name=self.variant_name,
            config=config,
            environment=self.active_trace.environment,
            parent_span_id=self.parent_span_id,
            spankind=spankind.upper(),
            attributes={},
            status=SpanStatusCode.UNSET.value,
            start_time=datetime.now(timezone.utc),
        )

        self.active_span = span
        self.span_dict[span.id] = span
        self.parent_span_id = span.id
        self.llm_logger.info(
            f"Recorded active_span and setting parent_span_id: {span.id}"
        )
        return span

    def update_span_status(self, span: CreateSpan, value: str):
        updated_span = CreateSpan(**{**span.dict(), "status": value})
        self.active_span = updated_span

    def end_span(self, outputs: Dict[str, Any], span: CreateSpan, **kwargs):
        updated_span = CreateSpan(
            **span.dict(),
            end_time=datetime.now(timezone.utc),
            outputs=[outputs["message"]],
            cost=outputs.get("cost", None),
            tokens=outputs.get("usage"),
        )

        # Push span to list of recorded spans
        self.recorded_spans.append(updated_span)
        self.llm_logger.info(
            f"Pushed {updated_span.spankind} span {updated_span.id} to recorded spans."
        )

    def end_recording(self, outputs: Dict[str, Any], span: CreateSpan, **kwargs):
        self.end_span(outputs=outputs, span=span, **kwargs)
        if self.api_key == "":
            return

        self.llm_logger.info(f"Preparing to send recorded spans for processing.")
        self.llm_logger.info(f"Recorded spans => {len(self.recorded_spans)}")
        self.tasks_manager.add_task(
            self.active_trace.id,
            "trace",
            self.client.create_traces(
                trace=self.recording_trace_id, spans=self.recorded_spans  # type: ignore
            ),
            self.client,
        )
        self.llm_logger.info(
            f"Tracing for {span.id} recorded successfully and sent for processing."
        )
        self._clear_recorded_spans()

    def _create_trace_id(self) -> str:
        """Creates a unique mongo id for the trace object.

        Returns:
            str: stringify oid of the trace
        """

        return str(ObjectId())

    def _create_span_id(self) -> str:
        """Creates a unique mongo id for the span object.

        Returns:
            str: stringify oid of the span
        """

        return str(ObjectId())

    def _clear_recorded_spans(self) -> None:
        """
        Clear the list of recorded spans to prepare for next batch processing.
        """

        self.recorded_spans = []
        self.llm_logger.info(
            f"Cleared all recorded spans from batch: {self.recorded_spans}"
        )
