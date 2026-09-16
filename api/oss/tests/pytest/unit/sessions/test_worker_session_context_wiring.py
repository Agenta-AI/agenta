"""The queue workers must read the session before they tell an agent to name it.

A queued approval resume and a trigger fire both reach `invoke_workflow_detached`, which shares
the invoke prelude with the API. The prelude can only report the session's name and the
first-turn flag when a resolver is installed on the service that runs the turn. `routers.py`
installs one; the worker compositions used not to, so every turn a worker drove reported the
session as unnamed and first.
"""

from unittest.mock import AsyncMock, patch

import pytest

from entrypoints import worker_queues
from oss.src.core.workflows.service import WorkflowsService


@pytest.mark.parametrize(
    "builder",
    ["_build_triggers_broker", "_build_interactions_broker"],
)
def test_a_queue_worker_installs_the_session_context_resolver(builder):
    with (
        patch.object(worker_queues, "_install_session_context_resolver") as install,
        patch.object(worker_queues, "TrimOnAckRedisStreamBroker"),
    ):
        getattr(worker_queues, builder)()

    install.assert_called_once()
    assert isinstance(install.call_args.args[0], WorkflowsService)


async def test_the_installed_resolver_reads_the_stream_header_and_the_latest_turn():
    service = WorkflowsService(workflows_dao=AsyncMock())

    with (
        patch.object(worker_queues, "SessionStreamsDAO"),
        patch.object(worker_queues, "SessionTurnsDAO"),
        patch.object(worker_queues, "get_lock_engine"),
        patch.object(worker_queues.SessionStreamsService, "fetch_header") as header,
        patch.object(worker_queues.SessionTurnsService, "latest_turn") as latest,
    ):
        header.return_value = type("H", (), {"name": "Q3 notes"})()
        latest.return_value = object()
        worker_queues._install_session_context_resolver(
            service, transactions_engine=object()
        )
        resolved = await service._session_context_resolver(
            project_id="p", session_id="sess-1"
        )

    assert resolved == ("Q3 notes", False)
