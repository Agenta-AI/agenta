"""Unit tests for trigger event discovery (find_triggers)."""

from types import SimpleNamespace
from uuid import uuid4

from unittest.mock import AsyncMock, MagicMock

import pytest

from oss.src.apis.fastapi.triggers.models import TriggerDiscoveryQuery
from oss.src.apis.fastapi.triggers.router import TriggersRouter
from oss.src.core.triggers.dtos import (
    TriggerCapabilitiesResult,
    TriggerCatalogEvent,
    TriggerCatalogEventDetails,
    TriggerCatalogEventsPage,
    TriggerCatalogIntegration,
    TriggerCatalogIntegrationsPage,
    TriggerConnection,
    TriggerDiscoveryConnectionState,
)
from oss.src.core.triggers.service import TriggersService


def _service(*, connections=None, integration=None):
    catalog_service = MagicMock()
    catalog_service.get_integration = AsyncMock(
        return_value=integration
        or TriggerCatalogIntegration(
            key="github",
            name="GitHub",
            auth_schemes=["oauth"],
        )
    )
    connections_service = MagicMock()
    connections_service.query_connections = AsyncMock(return_value=connections or [])
    return TriggersService(
        adapter_registry=MagicMock(),
        catalog_service=catalog_service,
        triggers_dao=MagicMock(),
        connections_service=connections_service,
        workflows_service=MagicMock(),
    )


def _ready_connection(connection_id):
    return TriggerConnection(
        id=connection_id,
        slug="github-main",
        name="GitHub main",
        provider_key="composio",
        integration_key="github",
        data={"connected_account_id": "ca_1"},
        flags={"is_active": True, "is_valid": True},
    )


async def test_discover_triggers_returns_event_details_and_ready_connection():
    connection_id = uuid4()
    service = _service(connections=[_ready_connection(connection_id)])
    service.list_integrations = AsyncMock(
        return_value=TriggerCatalogIntegrationsPage(
            integrations=[TriggerCatalogIntegration(key="github", name="GitHub")],
            total=1,
        )
    )
    service.list_events = AsyncMock(
        return_value=TriggerCatalogEventsPage(
            events=[
                TriggerCatalogEvent(
                    key="github_issue_opened",
                    name="Issue opened",
                    description="Triggers when a GitHub issue is opened.",
                    provider="composio",
                    integration="github",
                ),
                TriggerCatalogEvent(
                    key="github_comment_created",
                    name="Comment created",
                    provider="composio",
                    integration="github",
                ),
            ],
            total=2,
        )
    )
    service.get_event = AsyncMock(
        return_value=TriggerCatalogEventDetails(
            key="github_issue_opened",
            name="Issue opened",
            description="Triggers when a GitHub issue is opened.",
            provider="composio",
            integration="github",
            trigger_config={
                "type": "object",
                "properties": {"repo": {"type": "string"}},
            },
            payload={"issue": {"title": "Bug"}},
        )
    )

    result = await service.discover_triggers(
        project_id=uuid4(),
        use_cases=["new github issue opened"],
        provider_key="composio",
        limit_alternatives=1,
    )

    assert result.ready is True
    assert len(result.capabilities) == 1
    capability = result.capabilities[0]
    assert capability.integration == "github"
    assert capability.event.event_key == "github_issue_opened"
    assert capability.event.trigger_config["properties"]["repo"]["type"] == "string"
    assert capability.event.payload == {"issue": {"title": "Bug"}}
    assert capability.connection.state == TriggerDiscoveryConnectionState.READY
    assert capability.connection.id == connection_id
    assert result.connections[0].slug == "github-main"
    assert result.capabilities[0].alternatives[0].event_key == "github_comment_created"


async def test_discovery_connection_state_needs_input_for_api_key_only_integration():
    service = _service(
        integration=TriggerCatalogIntegration(
            key="linear",
            name="Linear",
            auth_schemes=["api_key"],
        )
    )

    state = await service._trigger_discovery_connection_state(
        project_id=uuid4(),
        provider_key="composio",
        integration_key="linear",
    )

    assert state.state == TriggerDiscoveryConnectionState.NEEDS_INPUT
    assert state.connect.endpoint == "POST /triggers/connections/"
    assert state.connect.body == {
        "connection": {
            "provider_key": "composio",
            "integration_key": "linear",
            "slug": "linear-main",
        }
    }


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(project_id=str(uuid4()), user_id=str(uuid4()))
    )


def _router_with_discover(discover_fn):
    return TriggersRouter(
        triggers_service=SimpleNamespace(discover_triggers=discover_fn)
    )


async def test_discover_route_returns_trigger_capabilities(monkeypatch):
    captured = {}

    async def _discover(*, project_id, use_cases, provider_key, limit_alternatives):
        captured.update(
            project_id=project_id,
            use_cases=use_cases,
            provider_key=provider_key,
            limit_alternatives=limit_alternatives,
        )
        return TriggerCapabilitiesResult(ready=False)

    async def _allow(**_kwargs):
        return True

    monkeypatch.setattr(
        "oss.src.apis.fastapi.triggers.router.check_action_access",
        _allow,
    )

    request = _request()
    result = await _router_with_discover(_discover).discover_triggers(
        request,
        body=TriggerDiscoveryQuery(
            use_cases=["new github issue opened"],
            provider="composio",
            limit_alternatives=2,
        ),
    )

    assert isinstance(result, TriggerCapabilitiesResult)
    assert str(captured["project_id"]) == request.state.project_id
    assert captured["use_cases"] == ["new github issue opened"]
    assert captured["provider_key"] == "composio"
    assert captured["limit_alternatives"] == 2


def test_discover_route_is_registered_at_expected_path():
    router = _router_with_discover(AsyncMock())
    routes = {
        (route.path, tuple(sorted(route.methods))) for route in router.router.routes
    }
    assert ("/discover", ("POST",)) in routes


def test_trigger_discovery_query_rejects_empty_use_cases():
    with pytest.raises(Exception):
        TriggerDiscoveryQuery(use_cases=[" ", ""])


def test_trigger_discovery_query_rejects_scalar_string():
    with pytest.raises(Exception):
        TriggerDiscoveryQuery(use_cases="new github issue")
