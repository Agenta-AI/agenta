# Stdlib Imports
from bson import ObjectId
from datetime import datetime
from typing import Optional, Optional

# Own Imports
from agenta.client.backend import client
from agenta.sdk.tracing.logger import llm_logger
from agenta.sdk.tracing.tasks_manager import TaskQueue
from agenta.sdk.tracing.states import StatefulClient, StateTypes
from agenta.client.backend.client import AsyncObservabilityClient


class AgentaLLMTracing(object):
    """Agenta llm tracing object.

    Args:
        base_url (str): The URL of the backend host
        api_key (str): The API Key of the backend host
        tasks_manager (TaskQueue): The tasks manager dedicated to handling asynchronous tasks
        llm_logger (Logger): The logger associated with the LLM tracing
        max_workers (int): The maximum number of workers to run tracing
        manual_tracing (bool): Defaults to False, since observability would begin automatically when a LLM app is ran.
    """

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        max_workers: int = 4,
        manual_tracing: bool = False,
    ):
        self.base_url = base_url + "/api"
        self.api_key = api_key if api_key is not None else ""
        self.manual_tracing = manual_tracing
        self.llm_logger = llm_logger
        self.tasks_manager = TaskQueue(max_workers, logger=llm_logger)

    @property
    def client(self) -> AsyncObservabilityClient:
        """Initialize observability async client

        Returns:
            AsyncObservabilityClient: async client
        """

        return client.AsyncAgentaApi(
            base_url=self.base_url, api_key=self.api_key, timeout=120  # type: ignore
        ).observability

    def _create_trace_oid(self) -> str:
        """Creates a unique mongo oid for the trace object.

        Returns:
            str: stringify oid of the trace
        """

        return str(ObjectId())

    def trace(
        self,
        trace_name: Optional[str],
        app_id: str,
        base_id: str,
        config_name: str,
        **kwargs,
    ) -> StatefulClient:
        """Creates a new trace.

        Args:
            trace_name (Optional[str]): The identifier for the trace.
            app_id (str): The ID of the app.
            base_id (str): The ID of the base.
            config_name (str): The name of the config.

        Returns:
            StatefulClient: client used to make stateful calls.
        """

        trace_id = self._create_trace_oid()
        try:
            self.tasks_manager.add_task(
                self.client.create_trace(
                    id=trace_id,
                    app_id=app_id,
                    base_id=base_id,
                    config_name=config_name,
                    trace_name=trace_name,
                    start_time=datetime.now(),
                    model=kwargs["model"],
                    inputs=kwargs["inputs"],
                    environment=kwargs["environment"],  # type: ignore
                    status="INITIATED",
                    tags=[],
                )
            )
        except Exception as exc:
            self.llm_logger.error(f"Error creating trace: {str(exc)}")
        finally:
            return StatefulClient(
                client=self.client,
                trace_id=trace_id,
                llm_logger=self.llm_logger,
                state_type=StateTypes.TRACE,
                task_manager=self.tasks_manager,
                parent_span_id=None,
            )
