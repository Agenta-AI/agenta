# Stdlib Imports
from enum import Enum
from bson import ObjectId
from logging import Logger
from datetime import datetime
from typing import Dict, Any, Optional, List

# Own Imports
from agenta.sdk.tracing.tasks_manager import TaskQueue
from agenta.client.backend.client import AsyncObservabilityClient


class StateTypes(Enum):
    TRACE = 1
    SPAN = 2
    GENERATION = 3


class StatefulClient(object):
    """Base class for handling stateful operations in when tracing LLM; \
        capable of creating different nested objects like spans, and generations.

    Args:
        client (AsyncObservabilityClient): Core interface for Observability API.
        trace_id (str): Id of the trace associated with the stateful client.
        llm_logger (Logger): The logger associated with the LLM tracing.
        state_type (StateTypes): Enum indicating whether the client is a trace, span or generation.
        task_manager (TaskManager): Manager handling asynchronous tasks for the client.
        parent_span_id (Optional[str]): The parent ID of a span. Defaults to None
    """

    def __init__(
        self,
        client: AsyncObservabilityClient,
        trace_id: str,
        llm_logger: Logger,
        state_type: StateTypes,
        task_manager: TaskQueue,
        parent_span_id: Optional[str] = None,
    ):
        self.client = client
        self.trace_id = trace_id
        self.parent_span_id = parent_span_id
        self.llm_logger = llm_logger
        self.state_type = state_type
        self.task_manager = task_manager

    def _add_state_to_tracing(self, body: Dict[str, Any]) -> Dict[str, Any]:
        """Adds state based on type to the tracing.

        Args:
            body (Dict[str, Any]): tracing body

        Returns:
            Dict[str, Any]: updated body based on the state type
        """

        if self.state_type == StateTypes.TRACE:
            body["trace_id"] = self.trace_id
        elif self.state_type == StateTypes.SPAN:
            body["parent_span_id"] = self.parent_span_id
        return body

    def _create_span_oid(self) -> str:
        """Creates a unique mongo oid for the span object.

        Returns:
            str: stringify oid of the span
        """

        return str(ObjectId())

    def span(
        self, name: Optional[str], input: str, output: str, **kwargs: Dict[str, Any]
    ) -> "StatefulClient":  # type: ignore
        span_id = self._create_span_oid()
        try:
            self.task_manager.add_task(
                self.client.create_span(
                    trace_id=self.trace_id,
                    event_name=name,
                    event_type="llm_request",
                    status="",
                    input=input,
                    output=output,
                    environment=kwargs["environment"],
                    start_time=datetime.now(),
                    tokens=kwargs.get("usage", None),
                )
            )
            self.parent_span_id = span_id
        except Exception as exc:
            self.llm_logger.error(
                f"Error creating span of trace {str(self.trace_id)}: {str(exc)}"
            )
        finally:
            return StatefulClient(
                client=self.client,
                trace_id=self.trace_id,
                llm_logger=self.llm_logger,
                state_type=StateTypes.SPAN,
                task_manager=self.task_manager,
                parent_span_id=(
                    self._create_span_oid()
                    if not self.parent_span_id
                    else self.parent_span_id
                ),
            )

    def span_child(self, parent_span_id: str, event_name: str):
        raise NotImplemented("TODO: Implement creation of span child.")  # type: ignore

    def end(
        self,
        output: str,
        usage: Optional[Dict[str, Any]],
        tags: Optional[List[str]],
        **kwargs: Dict[str, Any],
    ):
        try:
            self.task_manager.add_task(
                self.client.update_trace(
                    self.trace_id,
                    output=output,
                    status="COMPLETED",
                    usage=usage,
                    tags=tags,
                    end_time=datetime.now(),
                    **kwargs,
                )
            )
        except Exception as exc:
            self.llm_logger.error(
                f"Error ending trace {str(self.trace_id)} request: {str(exc)}"
            )
