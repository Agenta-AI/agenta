import os
from threading import Lock
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from agenta.sdk.tracing.logger import llm_logger
from agenta.sdk.tracing.tasks_manager import TaskQueue
from agenta.client.backend.client import AsyncAgentaApi
from agenta.client.backend.client import AsyncObservabilityClient
from agenta.client.backend.types.create_span import (
    CreateSpan,
    LlmTokens,
    SpanStatusCode,
)

from bson.objectid import ObjectId


VARIANT_TRACKING_FEATURE_FLAG = False


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
        host (str): The URL of the backend host
        api_key (str): The API Key of the backend host
        tasks_manager (TaskQueue): The tasks manager dedicated to handling asynchronous tasks
        llm_logger (Logger): The logger associated with the LLM tracing
        max_workers (int): The maximum number of workers to run tracing
    """

    def __init__(
        self,
        host: str,
        app_id: str,
        api_key: Optional[str] = None,
        max_workers: Optional[int] = None,
    ):
        self.host = host + "/api"
        self.api_key = api_key if api_key is not None else ""
        self.llm_logger = llm_logger
        self.app_id = app_id
        self.tasks_manager = TaskQueue(
            max_workers if max_workers else 4, logger=llm_logger
        )
        self.active_span: Optional[CreateSpan] = None
        self.active_trace_id: Optional[str] = None
        self.pending_spans: List[CreateSpan] = []
        self.tags: List[str] = []
        self.trace_config_cache: Dict[
            str, Any
        ] = {}  # used to save the trace configuration before starting the first span
        self.span_dict: Dict[str, CreateSpan] = {}  # type: ignore

    @property
    def client(self) -> AsyncObservabilityClient:
        """Initialize observability async client

        Returns:
            AsyncObservabilityClient: async client
        """

        return AsyncAgentaApi(
            base_url=self.host, api_key=self.api_key, timeout=120  # type: ignore
        ).observability

    def set_span_attribute(
        self,
        attributes: Dict[str, Any] = {},
    ):
        """
        Set attributes for the active span.

        Args:
            attributes (Dict[str, Any], optional): A dictionary of attributes to set. Defaults to {}.
        """

        if (
            self.active_span is None
        ):  # This is the case where entrypoint wants to save the trace information but the parent span has not been initialized yet
            for key, value in attributes.items():
                self.trace_config_cache[key] = value
        else:
            for key, value in attributes.items():
                self.active_span.attributes[key] = value  # type: ignore

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
            config=config,
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

        if self.active_trace_id is None:  # This is a parent span
            self.active_trace_id = self._create_trace_id()
            span.environment = (
                self.trace_config_cache.get("environment")
                if self.trace_config_cache is not None
                else os.environ.get("environment", "unset")
            )
            span.config = (
                self.trace_config_cache.get("config")
                if not config and self.trace_config_cache is not None
                else None
            )
            if VARIANT_TRACKING_FEATURE_FLAG:
                # TODO: we should get the variant_id and variant_name (and environment) from the config object
                span.variant_id = config.variant_id  # type: ignore
                span.variant_name = (config.variant_name,)  # type: ignore

        else:
            span.parent_span_id = self.active_span.id  # type: ignore

        self.span_dict[span.id] = span
        self.active_span = span

        self.llm_logger.info(f"Recorded span and setting parent_span_id: {span.id}")
        return span

    def update_span_status(self, span: CreateSpan, value: str):
        span.status = value

    def _update_span_cost(self, span: CreateSpan, cost: Optional[float]):
        if cost is not None and isinstance(cost, float):
            if span.cost is None:
                span.cost = cost
            else:
                span.cost += cost

    def _update_span_tokens(self, span: CreateSpan, tokens: Optional[dict]):
        if isinstance(tokens, LlmTokens):
            tokens = tokens.dict()
        if tokens is not None and isinstance(tokens, dict):
            if span.tokens is None:
                span.tokens = LlmTokens(**tokens)
            else:
                span.tokens.prompt_tokens += tokens["prompt_tokens"]
                span.tokens.completion_tokens += tokens["completion_tokens"]
                span.tokens.total_tokens += tokens["total_tokens"]

    def end_span(self, outputs: Dict[str, Any]):
        """
        Ends the active span, if it is a parent span, ends the trace too.

        Args:
            outputs (Dict[str, Any]): A dictionary containing the outputs of the span.
                It should have the following keys:
                - "message" (str): The message output of the span.
                - "cost" (Optional[Any]): The cost of the span.
                - "usage" (Optional[Any]): The number of tokens used in the span.

        Raises:
            ValueError: If there is no active span to end.

        Returns:
            None
        """

        if self.active_span is None:
            raise ValueError("There is no active span to end.")

        self.active_span.end_time = datetime.now(timezone.utc)
        self.active_span.outputs = [outputs.get("message", "")]
        if self.active_span.spankind in [
            "LLM",
            "RETRIEVER",
        ]:  # TODO: Remove this whole part. Setting the cost should be done through set_span_attribute
            self._update_span_cost(self.active_span, outputs.get("cost", None))
            self._update_span_tokens(self.active_span, outputs.get("usage", None))

        # Push span to list of recorded spans
        self.pending_spans.append(self.active_span)

        active_span_parent_id = self.active_span.parent_span_id
        if (
            self.active_span.status == SpanStatusCode.ERROR.value
            and active_span_parent_id is not None
        ):
            self.record_exception_and_end_trace(span_parent_id=active_span_parent_id)

        if active_span_parent_id is None:
            self.end_trace(parent_span=self.active_span)

        else:
            parent_span = self.span_dict[active_span_parent_id]
            self._update_span_cost(parent_span, self.active_span.cost)
            self._update_span_tokens(parent_span, self.active_span.tokens)
            self.active_span = parent_span

    def record_exception_and_end_trace(self, span_parent_id: str):
        """
        Record an exception and end the trace.

        Args:
            span_parent_id (str): The ID of the parent span.

        Returns:
            None
        """

        parent_span = self.span_dict.get(span_parent_id)
        if parent_span is not None:
            # Update parent span of active span
            parent_span.outputs = self.active_span.outputs  # type: ignore
            parent_span.status = "ERROR"
            parent_span.end_time = datetime.now(timezone.utc)

            # Push parent span to list of recorded spans and end trace
            self.pending_spans.append(parent_span)
            self.end_trace(parent_span=parent_span)

        # TODO: improve exception logic here.

    def end_trace(self, parent_span: CreateSpan):
        """
        Ends the active trace and sends the recorded spans for processing.

        Args:
            parent_span (CreateSpan): The parent span of the trace.

        Raises:
            RuntimeError: If there is no active trace to end.

        Returns:
            None
        """

        if self.api_key == "":
            return

        if not self.active_trace_id:
            raise RuntimeError("No active trace to end.")

        self.llm_logger.info("Preparing to send recorded spans for processing.")
        self.llm_logger.info(f"Recorded spans => {len(self.pending_spans)}")
        self.tasks_manager.add_task(
            self.active_trace_id,
            "trace",
            self.client.create_traces(
                trace=self.active_trace_id, spans=self.pending_spans  # type: ignore
            ),
            self.client,
        )
        self.llm_logger.info(
            f"Tracing for {parent_span.id} recorded successfully and sent for processing."
        )
        self._clear_pending_spans()
        self.active_trace_id = None
        self.active_span = None
        self.trace_config_cache.clear()

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

    def _clear_pending_spans(self) -> None:
        """
        Clear the list of recorded spans to prepare for next batch processing.
        """

        self.pending_spans = []
        self.llm_logger.info(
            f"Cleared all recorded spans from batch: {self.pending_spans}"
        )
