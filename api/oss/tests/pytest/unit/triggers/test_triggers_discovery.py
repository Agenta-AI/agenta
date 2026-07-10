"""Unit tests for trigger event discovery (discover_triggers)."""

import asyncio
from types import SimpleNamespace
from uuid import uuid4

from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError

from oss.src.apis.fastapi.triggers.models import TriggerDiscoveryQuery
from oss.src.apis.fastapi.triggers.router import TriggersRouter
from oss.src.core.triggers.dtos import (
    TriggerCapabilitiesResult,
    TriggerCatalogEventDetails,
    TriggerCatalogEventsSnapshot,
    TriggerCatalogIntegration,
    TriggerConnection,
    TriggerDiscoveryConnectionState,
)
from oss.src.core.triggers.exceptions import AdapterError
from oss.src.core.triggers.service import (
    TriggersService,
    _discovery_terms,
    _has_primary_evidence,
    _match_signal,
    _score_trigger_match,
)
from oss.src.utils.env import env


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


def _snapshot(events, integration_names=None):
    return TriggerCatalogEventsSnapshot(
        events=events,
        integration_names=(
            integration_names if integration_names is not None else {"github": "GitHub"}
        ),
    )


def _wire_catalog(service, snapshot):
    adapter = SimpleNamespace(list_all_events=AsyncMock(return_value=snapshot))
    service.adapter_registry.get = MagicMock(return_value=adapter)
    return adapter


async def test_discover_triggers_returns_event_details_and_ready_connection():
    connection_id = uuid4()
    service = _service(connections=[_ready_connection(connection_id)])
    _wire_catalog(
        service,
        _snapshot(
            [
                TriggerCatalogEventDetails(
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
                ),
                TriggerCatalogEventDetails(
                    key="github_comment_created",
                    name="Comment created",
                    provider="composio",
                    integration="github",
                ),
            ]
        ),
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
    with pytest.raises(ValidationError):
        TriggerDiscoveryQuery(use_cases=[" ", ""])


def test_trigger_discovery_query_rejects_scalar_string():
    with pytest.raises(ValidationError):
        TriggerDiscoveryQuery(use_cases="new github issue")


# ---------------------------------------------------------------------------
# Scoring + evidence helpers (the heart of the discovery logic).
# ---------------------------------------------------------------------------


def _event(key, name="", description="", integration="github", provider="composio"):
    # Details subclass so the same helper feeds both scoring tests and snapshots.
    return TriggerCatalogEventDetails(
        key=key,
        name=name,
        description=description,
        integration=integration,
        provider=provider,
    )


def _integration(key="github", name="GitHub", description=""):
    return TriggerCatalogIntegration(key=key, name=name, description=description)


def test_discovery_terms_drops_stopwords_and_dedups():
    assert _discovery_terms("New GitHub issue, on the issue!") == ["github", "issue"]


def test_discovery_terms_skips_single_characters():
    assert _discovery_terms("a github b") == ["github"]


def test_discovery_terms_empty_input():
    assert _discovery_terms("") == []
    assert _discovery_terms("the a of to") == []


def test_match_signal_rewards_exact_phrase():
    score, terms, exact = _match_signal(
        use_case="issue opened",
        event=_event("github_issue_opened", "Issue opened"),
        integration=_integration(),
    )
    assert exact is True
    assert score >= 50
    assert terms == 2


def test_match_signal_counts_distinct_terms_without_exact_phrase():
    score, terms, exact = _match_signal(
        use_case="github comment",
        event=_event("github_comment_created", "Comment created"),
        integration=_integration(),
    )
    assert exact is False
    assert terms == 2
    assert score > 0


def test_match_signal_single_generic_term():
    score, terms, exact = _match_signal(
        use_case="issue triage",
        event=_event("jira_issue_created", "Issue created", integration="jira"),
        integration=_integration("jira", "Jira"),
    )
    assert exact is False
    assert terms == 1
    assert score > 0


def test_score_zero_when_nothing_matches():
    assert (
        _score_trigger_match(
            use_case="weather forecast",
            event=_event("github_push", "Push"),
            integration=_integration(),
        )
        == 0
    )


def test_primary_evidence_true_for_two_terms():
    assert (
        _has_primary_evidence(
            use_case="github issue",
            event=_event("github_issue_opened", "Issue opened"),
            integration=_integration(),
        )
        is True
    )


def test_primary_evidence_true_for_exact_phrase_single_term():
    # A single distinct term, but the whole phrase appears verbatim -> strong enough.
    assert (
        _has_primary_evidence(
            use_case="github",
            event=_event("github_issue_opened", "Issue opened"),
            integration=_integration(),
        )
        is True
    )


def test_primary_evidence_false_for_single_generic_term():
    assert (
        _has_primary_evidence(
            use_case="issue triage",
            event=_event("jira_issue_created", "Issue created", integration="jira"),
            integration=_integration("jira", "Jira"),
        )
        is False
    )


# ---------------------------------------------------------------------------
# _discover_events_for_use_case: ranking + zero-score drop.
# ---------------------------------------------------------------------------


def test_discover_events_ranks_by_score_descending():
    matches = TriggersService._discover_events_for_use_case(
        use_case="github issue opened",
        snapshot=_snapshot(
            [
                _event("github_comment_created", "Comment created"),
                _event(
                    "github_issue_opened",
                    "Issue opened",
                    "Triggers when a github issue is opened",
                ),
            ]
        ),
    )

    keys = [event.key for _score, event, _integration in matches]
    assert keys == ["github_issue_opened", "github_comment_created"]
    scores = [score for score, _event, _integration in matches]
    assert scores == sorted(scores, reverse=True)


def test_discover_events_drops_zero_score_candidates():
    matches = TriggersService._discover_events_for_use_case(
        use_case="issue opened",
        snapshot=_snapshot(
            [
                _event("github_issue_opened", "Issue opened", "An issue was opened"),
                _event("github_push", "Push", "Code was pushed"),
            ]
        ),
    )

    keys = [event.key for _score, event, _integration in matches]
    assert keys == ["github_issue_opened"]
    assert all(score > 0 for score, _event, _integration in matches)


# ---------------------------------------------------------------------------
# discover_triggers: primary-evidence gate, no-match paths, multiple use cases.
# ---------------------------------------------------------------------------


def _discovery_service(*, events, integration_names=None, connections=None):
    service = _service(connections=connections)
    _wire_catalog(service, _snapshot(events, integration_names))
    return service


async def test_discover_triggers_no_match_for_weak_single_term():
    # The only candidate shares a single generic term ("issue") with the use case, so it must
    # not be promoted to the primary match; the use case falls to the no-match path instead.
    service = _discovery_service(
        events=[
            _event(
                "jira_issue_created",
                "Issue created",
                "Fires on a new issue",
                integration="jira",
            )
        ],
        integration_names={"jira": "Jira"},
    )
    service.get_event = AsyncMock()

    result = await service.discover_triggers(
        project_id=uuid4(),
        use_cases=["issue triage"],
        provider_key="composio",
        limit_alternatives=2,
    )

    assert result.ready is False
    assert len(result.capabilities) == 1
    capability = result.capabilities[0]
    assert capability.event is None
    assert capability.note is not None
    assert result.notes
    service.get_event.assert_not_called()


async def test_discover_triggers_no_match_when_no_events():
    service = _discovery_service(events=[], integration_names={})

    result = await service.discover_triggers(
        project_id=uuid4(),
        use_cases=["something with no catalog hit"],
        provider_key="composio",
        limit_alternatives=2,
    )

    assert result.ready is False
    assert result.capabilities[0].event is None
    assert result.connections == []


async def test_discover_triggers_mixed_match_and_no_match():
    service = _discovery_service(
        events=[
            TriggerCatalogEventDetails(
                key="github_issue_opened",
                name="Issue opened",
                description="Triggers when a github issue is opened",
                provider="composio",
                integration="github",
                trigger_config={"type": "object"},
                payload={},
            )
        ],
        connections=[],
    )

    result = await service.discover_triggers(
        project_id=uuid4(),
        use_cases=["new github issue opened", "quantum teleportation alert"],
        provider_key="composio",
        limit_alternatives=2,
    )

    assert len(result.capabilities) == 2
    matched, missed = result.capabilities
    assert matched.event.event_key == "github_issue_opened"
    # The default integration advertises oauth only, and there is no ready connection.
    assert matched.connection.state == TriggerDiscoveryConnectionState.NEEDS_AUTH
    assert missed.event is None
    assert result.ready is False
    # One catalog fetch per request, not per use case.
    adapter = service.adapter_registry.get.return_value
    adapter.list_all_events.assert_awaited_once()


async def test_discover_triggers_adjacency_bonus_breaks_catalog_order_tie():
    # Live regression: github/issue/created hit both events equally, and the comment
    # event comes first in catalog order, so without the adjacency bonus the stable
    # sort would surface it as primary.
    service = _discovery_service(
        events=[
            _event(
                "GITHUB_ISSUE_COMMENT_CREATED_TRIGGER",
                "Issue Comment Created",
                "Triggered when a comment is created on an issue",
            ),
            _event(
                "GITHUB_ISSUE_CREATED_TRIGGER",
                "Issue Created",
                "Triggered when a new issue is created",
            ),
        ],
    )

    result = await service.discover_triggers(
        project_id=uuid4(),
        use_cases=["when a new GitHub issue is created"],
        provider_key="composio",
        limit_alternatives=2,
    )

    capability = result.capabilities[0]
    assert capability.event.event_key == "GITHUB_ISSUE_CREATED_TRIGGER"
    assert [alt.event_key for alt in capability.alternatives] == [
        "GITHUB_ISSUE_COMMENT_CREATED_TRIGGER"
    ]


async def test_discover_triggers_adjacency_bonus_ignores_integration_name_bigrams():
    # Live regression: "slack message" is adjacent in SLACK_MESSAGE_REACTION_ADDED's
    # key only because every slack event key starts with the integration name. With
    # integration-name tokens excluded from pairing, no event gets a bonus here and
    # base scores surface the channel-message events over the reaction event.
    service = _discovery_service(
        events=[
            _event(
                "SLACK_MESSAGE_REACTION_ADDED",
                "Message Reaction Added",
                "Triggered when a reaction is added to a message in a channel",
                integration="slack",
            ),
            _event(
                "SLACKBOT_CHANNEL_MESSAGE_RECEIVED",
                "Channel Message Received",
                "Triggered when a message is posted to a channel",
                integration="slackbot",
            ),
            _event(
                "SLACK_CHANNEL_MESSAGE_RECEIVED",
                "Channel Message Received",
                "Triggered when a message is posted to a channel",
                integration="slack",
            ),
        ],
        integration_names={"slack": "Slack", "slackbot": "Slackbot"},
    )

    result = await service.discover_triggers(
        project_id=uuid4(),
        use_cases=["new Slack message in a channel"],
        provider_key="composio",
        limit_alternatives=2,
    )

    capability = result.capabilities[0]
    assert capability.event.event_key in {
        "SLACKBOT_CHANNEL_MESSAGE_RECEIVED",
        "SLACK_CHANNEL_MESSAGE_RECEIVED",
    }
    assert "SLACK_MESSAGE_REACTION_ADDED" in [
        alt.event_key for alt in capability.alternatives
    ]


async def test_discovery_connection_state_increments_slug_on_collision():
    existing = TriggerConnection(
        id=uuid4(),
        slug="github-main",
        name="GitHub (paused)",
        provider_key="composio",
        integration_key="github",
        data={},
        flags={"is_active": False, "is_valid": False},
    )
    service = _service(connections=[existing])

    state = await service._trigger_discovery_connection_state(
        project_id=uuid4(),
        provider_key="composio",
        integration_key="github",
    )

    assert state.state == TriggerDiscoveryConnectionState.NEEDS_AUTH
    assert state.connect.body["connection"]["slug"] == "github-main-2"


# ---------------------------------------------------------------------------
# _cached_event_catalog: cache hit/miss + fetch deadline.
# ---------------------------------------------------------------------------


async def test_cached_event_catalog_hit_skips_adapter(monkeypatch):
    service = _service()
    adapter = _wire_catalog(service, _snapshot([]))
    cached = _snapshot([_event("github_issue_opened", "Issue opened")])

    async def _hit(**_kwargs):
        return cached

    async def _noop(**_kwargs):
        return None

    monkeypatch.setattr("oss.src.core.triggers.service.get_cache", _hit)
    monkeypatch.setattr("oss.src.core.triggers.service.set_cache", _noop)

    snapshot = await service._cached_event_catalog(provider_key="composio")

    assert snapshot is cached
    adapter.list_all_events.assert_not_called()


async def test_cached_event_catalog_miss_fetches_once_and_caches(monkeypatch):
    fetched = _snapshot([_event("github_issue_opened", "Issue opened")])
    service = _service()
    adapter = _wire_catalog(service, fetched)

    writes = []

    async def _miss(**_kwargs):
        return None

    async def _capture(**kwargs):
        writes.append(kwargs)

    monkeypatch.setattr("oss.src.core.triggers.service.get_cache", _miss)
    monkeypatch.setattr("oss.src.core.triggers.service.set_cache", _capture)

    snapshot = await service._cached_event_catalog(provider_key="composio")

    assert snapshot == fetched
    adapter.list_all_events.assert_awaited_once()
    assert len(writes) == 1
    assert writes[0]["value"] == fetched
    assert writes[0]["ttl"] == env.composio.catalog_cache_ttl_seconds


async def test_cached_event_catalog_deadline_raises_adapter_error(monkeypatch):
    service = _service()

    async def _hang():
        await asyncio.sleep(60)

    service.adapter_registry.get = MagicMock(
        return_value=SimpleNamespace(list_all_events=_hang)
    )
    monkeypatch.setattr(env.composio, "catalog_fetch_deadline_seconds", 0.01)

    with pytest.raises(AdapterError):
        await service._cached_event_catalog(provider_key="composio")
