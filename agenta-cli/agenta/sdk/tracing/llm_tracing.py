# Stdlib Imports
import os
from threading import Lock
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


class SingletonMeta(type):
    """
    Thread-safe implementation of Singleton.
    """

    _instances = {}  # type: ignore

    # We need the lock mechanism to synchronize threads \
    # during the initial access to the Singleton object.
    _lock: Lock = Lock()

    def __call__(cls, *args, **kwargs):
        """
        Ensures that changes to the `__init__` arguments do not affect the
        returned instance.

        Uses a lock to make this method thread-safe. If an instance of the class
        does not already exist, it creates one. Otherwise, it returns the
        existing instance.
        """

        with cls._lock:
            if cls not in cls._instances:
                instance = super().__call__(*args, **kwargs)
                cls._instances[cls] = instance
        return cls._instances[cls]


class Tracing(metaclass=SingletonMeta):
    """The `Tracing` class is an agent for LLM tracing with specific initialization arguments.

    __init__ args:
        base_url (str): The URL of the backend host
        api_key (str): The API Key of the backend host
        tasks_manager (TaskQueue): The tasks manager dedicated to handling asynchronous tasks
        llm_logger (Logger): The logger associated with the LLM tracing
        max_workers (int): The maximum number of workers to run tracing
    """

    def __init__(
        self,
        base_url: str,
        app_id: str,
        variant_id: Optional[str] = None,
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
        self.active_span: Optional[CreateSpan] = None
        self.active_trace: Optional[CreateSpan] = None
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

    def start_span(
        self,
        name: str,
        spankind: str,
        input: Dict[str, Any],
        config: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> CreateSpan:
        span_id = self._create_span_id()
        self.llm_logger.info(
            f"Recording {'parent' if spankind == 'workflow' else spankind} span..."
        )
        span = CreateSpan(
            id=span_id,
            inputs=input,
            name=name,
            app_id=self.app_id,
            variant_id=self.variant_id,
            variant_name=self.variant_name,
            config=config,
            environment=(
                self.active_trace.environment
                if self.active_trace
                else os.environ.get("AGENTA_LLM_RUN_ENVIRONMENT", "unset")
            ),
            spankind=spankind.upper(),
            attributes={},
            status=SpanStatusCode.UNSET.value,
            start_time=datetime.now(timezone.utc),
            outputs=None,
            tags=None,
            user=None,
            end_time=None,
            tokens=None,
            cost=None,
            token_consumption=None,
            parent_span_id=None,
        )

        if span.spankind == SpanKind.WORKFLOW.value:
            self.active_trace = span
            self.parent_span_id = span.id
            self.recording_trace_id = self._create_trace_id()
        else:
            self.active_span = span
            self.active_span = span
            self.span_dict[span.id] = span
            span.parent_span_id = (
                self.parent_span_id
            )  # set the parent_span_id to the present span
            self.parent_span_id = span.id  # update parent_span_id to active span

        self.llm_logger.info(f"Recorded span and setting parent_span_id: {span.id}")
        return span

    def update_span_status(self, span: CreateSpan, value: str):
        span.status = value
        self.active_span = span

    def end_span(self, outputs: Dict[str, Any], span: CreateSpan):
        span.end_time = datetime.now(timezone.utc)
        span.outputs = [outputs["message"]]
        span.cost = outputs.get("cost", None)
        span.tokens = outputs.get("usage")

        # Push span to list of recorded spans
        self.recorded_spans.append(span)
        self.llm_logger.info(
            f"Pushed {span.spankind} span {span.id} to recorded spans."
        )

        # End tracing if spankind is workflow
        if span.spankind == SpanKind.WORKFLOW.value:
            self.end_recording(span=span)

    def end_recording(self, span: CreateSpan):
        if self.api_key == "":
            return

        if not self.active_trace:
            raise RuntimeError("No active trace to end.")

        self.llm_logger.info("Preparing to send recorded spans for processing.")
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
