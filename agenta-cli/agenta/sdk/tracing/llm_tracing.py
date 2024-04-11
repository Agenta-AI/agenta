# Stdlib Imports
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

# Own Imports
from agenta.client.backend import client
from agenta.sdk.tracing.logger import llm_logger
from agenta.sdk.tracing.tasks_manager import TaskQueue
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
        api_key: Optional[str] = None,
        max_workers: Optional[int] = None,
    ):
        self.base_url = base_url + "/api"
        self.api_key = api_key if api_key is not None else ""
        self.llm_logger = llm_logger
        self.app_id = app_id
        self.variant_id = variant_id
        self.tasks_manager = TaskQueue(
            max_workers if max_workers else 4, logger=llm_logger
        )
        self.active_span = CreateSpan
        self.active_trace = None
        self.recorded_spans: List[CreateSpan] = []
        self.tags: List[str] = []
        self.span_dict: Dict[str, CreateSpan] = {}  # type: ignore

    @property
    def client(self) -> AsyncObservabilityClient:
        """Initialize observability async client

        Returns:
            AsyncObservabilityClient: async client
        """

        return client.AsyncAgentaApi(
            base_url=self.base_url, api_key=self.api_key, timeout=120  # type: ignore
        ).observability

    def set_span_attribute(
        self, parent_key: Optional[str] = None, attributes: Dict[str, Any] = {}
    ):
        span = self.span_dict[self.active_span.id]  # type: ignore
        for key, value in attributes.items():
            self.set_attribute(span.attributes, key, value, parent_key)

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
        self, name: str, inputs: Dict[str, Any], config: Dict[str, Any]
    ):
        trace_id = self._create_trace_id()
        span_id = self._create_span_id()
        span = CreateSpan(
            **{
                "id": span_id,
                "app_id": self.app_id,
                "variant_id": self.variant_id,
                "inputs": inputs,
                "name": name,
                "config": config,
                "spankind": SpanKind.WORKFLOW,
                "status": SpanStatusCode.UNSET,
                "start_time": datetime.now(timezone.utc),
            }
        )
        self.active_span = span
        self.active_trace = trace_id
        self.parent_span_id = span_id

    def start_span(
        self,
        name: str,
        spankind: str,
        input: Dict[str, Any],
        config: Dict[str, Any] = {},
    ):
        span_id = self._create_span_id()
        span = CreateSpan(
            **{
                "id": span_id,
                "inputs": input,
                "name": name,
                "config": config,
                "parent_span_id": self.parent_span_id,
                "spankind": spankind,
                "status": SpanStatusCode.UNSET,
                "start_time": datetime.now(timezone.utc),
            }
        )
        self.active_span = span
        self.active_trace = self.active_trace
        self.parent_span_id = span_id

    def end_span(self, outputs: Dict[str, Any], span: CreateSpan, **kwargs):
        span.end_time = datetime.now(timezone.utc)
        span.outputs = [outputs["message"]]
        span.cost = outputs.get("cost", 0)
        span.environment = kwargs.get("environment")
        span.attributes = kwargs
        span.tokens = outputs.get("usage", {})

        # Push span to list of recorded spans
        self.recorded_spans.append(span)

    def end_recording(self, outputs: Dict[str, Any], span: CreateSpan, **kwargs):
        self.end_span(outputs=outputs, span=span, **kwargs)
        self.tasks_manager.add_task(
            self.active_trace,
            "trace",
            self.client.create_traces(trace="trace", spans=self.recorded_spans),
            self.client,
        )
        self.llm_logger.info(
            f"Tracing for {span.id} recorded successfully and sent for processing."
        )

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
