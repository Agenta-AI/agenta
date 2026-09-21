"""How an evaluation invokes a workflow, and where it reads the answer from.

Two rules, one per test, both of them in `core/evaluations/runtime/adapters.py` and neither
covered anywhere before. They are grouped because they are the same story from two ends: an
evaluation step feeds its output to the next step as input, so it must ask for a completed
value and it must read that value from where the batch envelope actually puts it.

Both adapters are exercised against a hand-written workflows service, so nothing here runs a
workflow, opens a socket or touches a database. What each test asserts is the request the
adapter sent and the result it built from the response it got back.
"""

from typing import Any, Dict, List
from uuid import uuid4

import pytest

from agenta.sdk.evaluations.runtime.models import (
    EvaluationStep,
    PlannedCell,
    ResolvedSourceItem,
    WorkflowExecutionRequest,
)
from agenta.sdk.models.evaluations import EvaluationStatus as SDKEvaluationStatus
from agenta.sdk.models.workflows import (
    WorkflowServiceBatchResponse,
    WorkflowServiceResponseData,
    WorkflowServiceStatus,
)

from oss.src.core.evaluations.runtime.adapters import (
    APIWorkflowRunner,
    APIWorkflowServiceRunner,
)

OUTPUTS = {"answer": "42"}


class _RecordingWorkflowsService:
    """Answers every invocation the same way, and keeps what it was asked."""

    def __init__(self, response: Any) -> None:
        self.response = response
        self.calls: List[Dict[str, Any]] = []

    async def invoke_workflow(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        return self.response


def _batch_response(outputs: Any = OUTPUTS) -> WorkflowServiceBatchResponse:
    """What `/invoke` actually returns: outputs nested under `data`, never on the response.

    This shape is the whole reason `_response_outputs` exists. `WorkflowBatchResponse` has no
    `outputs` attribute, so an adapter reading `response.outputs` reads `None` every time,
    whatever the workflow produced.
    """
    return WorkflowServiceBatchResponse(
        status=WorkflowServiceStatus(code=200),
        data=WorkflowServiceResponseData(outputs=outputs),
        trace_id="trace-1",
        span_id="span-1",
    )


def _execution_request(*, revision: Any) -> WorkflowExecutionRequest:
    run_id, scenario_id = uuid4(), uuid4()
    return WorkflowExecutionRequest(
        step=EvaluationStep(key="app", type="invocation", origin="auto"),
        cell=PlannedCell(
            run_id=run_id,
            scenario_id=scenario_id,
            step_key="app",
            repeat_idx=0,
            step_type="invocation",
            step_origin="auto",
            status="pending",
            should_execute=True,
        ),
        source=ResolvedSourceItem(
            kind="testcase",
            step_key="app",
            inputs={"question": "what is six times seven"},
        ),
        revision=revision,
    )


# ---------------------------------------------------------------------------
# Where the answer is read from
# ---------------------------------------------------------------------------


async def test_an_evaluation_reads_outputs_from_the_batch_envelope():
    # Reading `response.outputs` instead yields None for every evaluation ever run, because
    # the attribute does not exist on the batch response.
    service = _RecordingWorkflowsService(_batch_response())
    runner = APIWorkflowRunner(workflows_service=service)

    result = await runner.execute(
        project_id=uuid4(),
        user_id=uuid4(),
        request=_execution_request(revision={"data": {"parameters": {}}}),
    )

    assert result.status is SDKEvaluationStatus.SUCCESS
    assert result.outputs == OUTPUTS


async def test_an_adapter_that_puts_outputs_on_the_response_still_works():
    # The compatibility fallback, kept for lightweight adapters that answer with a flat
    # object rather than the envelope. Without a case here, deleting it would look free.
    class _FlatResponse:
        status = WorkflowServiceStatus(code=200)
        data = None
        outputs = OUTPUTS
        trace_id = None
        span_id = None

    service = _RecordingWorkflowsService(_FlatResponse())
    runner = APIWorkflowRunner(workflows_service=service)

    result = await runner.execute(
        project_id=uuid4(),
        user_id=uuid4(),
        request=_execution_request(revision={"data": {"parameters": {}}}),
    )

    assert result.outputs == OUTPUTS


# ---------------------------------------------------------------------------
# What is asked for
# ---------------------------------------------------------------------------


async def test_a_streaming_revision_is_still_invoked_in_batch_mode():
    """The rule that matters: a revision whose interactive default is streaming.

    Left alone, the evaluation would be handed a stream and the step after it would receive a
    generator where it expects a completed value.
    """
    service = _RecordingWorkflowsService(_batch_response())
    runner = APIWorkflowRunner(workflows_service=service)

    await runner.execute(
        project_id=uuid4(),
        user_id=uuid4(),
        request=_execution_request(
            revision={"flags": {"stream": True}, "data": {"parameters": {}}}
        ),
    )

    sent = service.calls[0]["request"]
    assert sent.flags["stream"] is False


async def test_the_revisions_other_flags_survive_the_override():
    # Only `stream` is decided by the evaluation. Replacing the whole dict would silently
    # drop whatever else the revision declared.
    service = _RecordingWorkflowsService(_batch_response())
    runner = APIWorkflowRunner(workflows_service=service)

    await runner.execute(
        project_id=uuid4(),
        user_id=uuid4(),
        request=_execution_request(
            revision={
                "flags": {"stream": True, "trim": True},
                "data": {"parameters": {}},
            }
        ),
    )

    sent = service.calls[0]["request"]
    assert sent.flags == {"stream": False, "trim": True}


@pytest.mark.parametrize(
    "flags, expected",
    [
        pytest.param({"stream": True}, {"stream": False}, id="a streaming request"),
        pytest.param(None, {"stream": False}, id="a request with no flags at all"),
        pytest.param(
            {"trim": True},
            {"trim": True, "stream": False},
            id="a request carrying other flags",
        ),
    ],
)
async def test_the_service_runner_forces_batch_mode_on_the_request_it_forwards(
    flags, expected
):
    """The second call site, which builds its request through a `request_builder`.

    It reaches the service as a plain kwargs dict rather than through the runner above, so
    the same rule needs its own enforcement and its own case.
    """
    service = _RecordingWorkflowsService(_batch_response())
    forwarded: Dict[str, Any] = {"request": {"flags": flags} if flags else {}}
    runner = APIWorkflowServiceRunner(
        workflows_service=service,
        request_builder=lambda _request: forwarded,
    )

    result = await runner.execute(
        _execution_request(revision={"data": {"parameters": {}}})
    )

    assert service.calls[0]["request"]["flags"] == expected
    assert result.outputs == OUTPUTS
