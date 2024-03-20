# Stdlib Imports
from datetime import datetime
from typing import Optional, Dict, Any, List

# Own Imports
from agenta.client.backend import client
from agenta.sdk.tracing.logger import llm_logger
from agenta.sdk.tracing.tasks_manager import TaskQueue
from agenta.client.backend.client import AsyncObservabilityClient

# Third Party Imports
from bson.objectid import ObjectId


class Span:
    def __init__(
        self,
        trace_id: str,
        span_id: str,
        name: str,
        input: str,
        event_type: str,
        parent_span_id: Optional[str] = None,
        **kwargs: Dict[str, Any],
    ):
        self.trace_id = trace_id
        self.span_id = span_id
        self.name = name
        self.event_type = event_type
        self.parent_span_id = parent_span_id
        self.start_time = datetime.now()
        self.end_time = Optional[datetime]
        self.input = input
        self.status = Dict[str, Any]
        self.output = Optional[Dict[str, Any]]
        self.cost = Optional[float]
        self.tokens = Optional[Dict[str, int]]
        self.attributes: Dict[str, Any] = kwargs

    def set_attribute(self, key: str, value: Any):
        self.attributes[key] = value

    def update_span_status(self, status: str, exc: Optional[str]):
        if status == "FAILED":
            self.status = {  # type: ignore
                "value": None,
                "error": {"message": status, "stacktrace": str(exc)},
            }
        elif status == "COMPLETED":
            self.status == {"value": status, "error": None}

    def end(self, output: Dict[str, Any]):
        self.end_time = datetime.now()
        self.output = output["message"]
        self.cost = output.get("cost", None)
        self.tokens = output.get("usage", {})

    def __dict__(self):
        return {
            "trace_id": self.trace_id,
            "span_id": self.span_id,
            "event_name": self.name,
            "event_type": self.event_type,
            "parent_span_id": self.parent_span_id,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "input": self.input,
            "output": self.output,
            "status": self.status,
            "tokens": self.tokens,
            "meta": self.attributes,
        }


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
        self.active_span = None
        self.active_trace = None
        self.tags: List[str] = []
        self.span_dict: Dict[str, Span] = {}  # type: ignore

    @property
    def client(self) -> AsyncObservabilityClient:
        """Initialize observability async client

        Returns:
            AsyncObservabilityClient: async client
        """

        return client.AsyncAgentaApi(
            base_url=self.base_url, api_key=self.api_key, timeout=120  # type: ignore
        ).observability

    def set_span_attribute(self, **kwargs: Dict[str, Any]):
        span = self.span_dict[self.active_span]  # type: ignore
        for k, v in kwargs.items():
            span.set_attribute(k, v)

    def set_trace_tags(self, tags: List[str]):
        self.tags.extend(tags)

    def start_span(
        self,
        name: str,
        input: str,
        event_type: str,
        trace_id: Optional[str] = None,
        parent_span_id: Optional[str] = None,
        **kwargs: Dict[str, Any],
    ) -> Span:
        trace_id = trace_id if trace_id else self._create_trace_id()
        span_id = self._create_span_id()
        parent_span_id = self.active_span if not parent_span_id else parent_span_id
        span = Span(
            trace_id=trace_id,
            span_id=span_id,
            name=name,
            event_type=event_type,
            parent_span_id=parent_span_id,
            input=input,
            **kwargs,
        )
        self.span_dict[span_id] = span
        self.active_span = span_id  # type: ignore
        return span

    def end_span(self, output: Dict[str, Any], span: Span):
        span.end(output=output)
        self.active_span = span.parent_span_id  # type: ignore
        try:
            self.tasks_manager.add_task(self._send_span(span=span))
            self.parent_span_id = span.span_id
        except Exception as exc:
            self.llm_logger.error(
                f"Error creating span of trace {str(span.trace_id)}: {str(exc)}"
            )

    async def _send_span(self, span: Span):
        return await self.client.create_span(**span.__dict__())

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

    def trace(
        self,
        trace_name: Optional[str],
        inputs: Dict[str, Any],
        variant_config: Dict[str, Any],
        **kwargs,
    ):
        """Creates a new trace.

        Args:
            trace_name (Optional[str]): The identifier for the trace.
            app_id (str): The ID of the app.
            base_id (str): The ID of the base.
            config_name (str): The name of the config.
        """

        trace_id = self._create_trace_id()
        try:
            self.llm_logger.info("Starting tracing...")
            self.tasks_manager.add_task(
                self.client.create_trace(
                    id=trace_id,
                    app_id=self.app_id,
                    variant_id=self.variant_id,
                    trace_name=trace_name,  # type: ignore
                    start_time=datetime.now(),
                    inputs=inputs,
                    variant_config=variant_config,
                    environment=kwargs.get("environment"),  # type: ignore
                    status="INITIATED",
                    tags=self.tags,
                )
            )
            self.active_trace = trace_id  # type: ignore
            self.llm_logger.info("Trace ended.")
        except Exception as exc:
            self.llm_logger.error(f"Error creating trace: {str(exc)}")

    def end_trace(self, outputs: List[str], **kwargs: Dict[str, Any]):
        try:
            self.tasks_manager.add_task(
                self.client.update_trace(
                    trace_id=self.active_trace,  # type: ignore
                    status="COMPLETED",
                    end_time=datetime.now(),
                    token_consumption=kwargs.get("total_tokens"),  # typ: ignore
                    outputs=outputs,
                )
            )
        except Exception as exc:
            self.llm_logger.error(f"Error creating trace: {str(exc)}")
