"""Every worker-queues builder gives its WorkflowsService the static catalog, so a
schedule fire, a channel message, an approval resume or an evaluation can run the
Builder, which has no workflow row."""

import pytest

from entrypoints import worker_queues
from oss.src.core.workflows.builder_agent import BUILDER_AGENT_SLUG


class _Composed(Exception):
    """Stops a builder right after it composes its WorkflowsService."""


@pytest.fixture
def composed(monkeypatch):
    captured = {}

    def _workflows_service(**kwargs):
        captured.update(kwargs)
        raise _Composed()

    monkeypatch.setattr(worker_queues, "WorkflowsService", _workflows_service)
    monkeypatch.setattr(
        worker_queues, "TrimOnAckRedisStreamBroker", lambda **_: object()
    )
    monkeypatch.setattr(worker_queues, "build_evaluations_broker", lambda **_: object())
    monkeypatch.setattr(worker_queues, "get_transactions_engine", lambda: object())
    return captured


@pytest.mark.parametrize(
    "builder",
    [
        "_build_triggers_broker",
        "_build_channels_inbox_broker",
        "_build_interactions_broker",
        "_build_evaluations_broker",
    ],
)
def test_worker_workflows_service_resolves_the_builder(composed, builder):
    with pytest.raises(_Composed):
        getattr(worker_queues, builder)()

    static_catalog = composed.get("static_catalog")
    assert static_catalog is not None
    assert static_catalog.is_static_slug(BUILDER_AGENT_SLUG)
    assert static_catalog.retrieve_revision(slug=BUILDER_AGENT_SLUG) is not None
