"""``gateway.run`` runs one integration tool, with identity from the private context.

The route never reads routing from the model's arguments and never repairs them. It
checks project access, the connection, and that the tool key belongs to the named
integration's catalog, which is also where the canonical provider action ID comes from.

The first test is qa.md case A17, a regression of a named defect: malformed arguments
used to be replaced with ``{}`` and run anyway.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from oss.src.apis.fastapi.tools.router import ToolsRouter
from oss.src.core.tools import service as service_module
from oss.src.core.tools.dtos import (
    ToolCall,
    ToolCallContext,
    ToolCallData,
    ToolCallFunction,
    ToolCatalogAction,
    ToolExecutionResponse,
    GatewayConnectionTool,
)
from oss.src.core.tools.exceptions import (
    AdapterError,
    ConnectionInactiveError,
    ConnectionInvalidError,
    ConnectionNotFoundError,
)
from oss.src.core.tools.service import ToolsService


GITHUB_CATALOG = [
    ToolCatalogAction(
        key="GET_AN_ISSUE",
        name="Get an issue",
        provider_action_id="GITHUB_GET_AN_ISSUE",
        read_only=True,
        input_schema={"type": "object", "properties": {}},
    ),
    ToolCatalogAction(
        key="CREATE_AN_ISSUE",
        name="Create an issue",
        provider_action_id="GITHUB_CREATE_AN_ISSUE",
        read_only=False,
        input_schema={"type": "object", "properties": {}},
    ),
    ToolCatalogAction(
        key="UPDATE_AN_ISSUE",
        name="Update an issue",
        provider_action_id="GITHUB_UPDATE_AN_ISSUE",
        read_only=False,
        input_schema={"type": "object", "properties": {}},
    ),
    ToolCatalogAction(
        key="LIST_REPOSITORY_ISSUES",
        name="List repository issues",
        provider_action_id="GITHUB_LIST_REPOSITORY_ISSUES",
        read_only=True,
        input_schema={"type": "object", "properties": {}},
    ),
    ToolCatalogAction(
        key="ADD_LABELS_TO_AN_ISSUE",
        name="Add labels to an issue",
        provider_action_id="GITHUB_ADD_LABELS_TO_AN_ISSUE",
        read_only=False,
        input_schema={"type": "object", "properties": {}},
    ),
    ToolCatalogAction(
        key="LOCK_AN_ISSUE",
        name="Lock an issue",
        provider_action_id="GITHUB_LOCK_AN_ISSUE",
        read_only=False,
        input_schema={"type": "object", "properties": {}},
    ),
]

ARGUMENTS = {"owner": "agenta-ai", "repo": "agenta", "title": "A bug"}

# ``None`` is one of the malformed argument payloads under test, so it cannot double as
# "use the valid ones".
_DEFAULT = object()


class FakeProvider:
    """Answers the catalog and records the execution request it is handed."""

    def __init__(
        self, *, catalog=None, response: Optional[ToolExecutionResponse] = None
    ):
        self.catalog = GITHUB_CATALOG if catalog is None else catalog
        self.response = response or ToolExecutionResponse(
            data={"number": 7}, successful=True
        )
        self.requests: List[Any] = []
        self.latest_version = "20250827_00"
        self.list_versions: List[Optional[str]] = []

    async def resolve_toolkit_version(self, *, integration_key: str, version: str):
        assert version == "latest"
        return self.latest_version

    async def list_all_actions(
        self, *, integration_key: str, toolkit_version: Optional[str] = None
    ):
        self.list_versions.append(toolkit_version)
        return self.catalog

    async def execute(self, *, request):
        self.requests.append(request)
        return self.response


def _router(
    monkeypatch,
    provider: FakeProvider,
    *,
    connection_error: Optional[Exception] = None,
    connection_calls: Optional[list] = None,
    allow_access: bool = True,
) -> ToolsRouter:
    service = object.__new__(ToolsService)
    service.adapter_registry = SimpleNamespace(get=lambda _key: provider)

    async def _connection(**kwargs):
        if connection_calls is not None:
            connection_calls.append(kwargs)
        if connection_error is not None:
            raise connection_error
        return SimpleNamespace(
            provider_connection_id="acc_1",
            data={"project_id": "proj-1"},
        )

    monkeypatch.setattr(service, "resolve_connection_by_slug", _connection)

    async def _get_cache(**_kwargs):
        return None

    async def _set_cache(**_kwargs):
        return None

    monkeypatch.setattr(service_module, "get_cache", _get_cache)
    monkeypatch.setattr(service_module, "set_cache", _set_cache)

    async def _access(**_kwargs):
        return allow_access

    monkeypatch.setattr(
        "oss.src.apis.fastapi.tools.router.check_action_access", _access
    )

    return ToolsRouter(tools_service=service)


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(project_id=str(uuid4()), user_id=str(uuid4())),
        headers={},
    )


def _run_call(
    *,
    arguments: Any = _DEFAULT,
    integration: Optional[str] = "github",
    connection: Optional[str] = "github-work",
    tool: Optional[str] = "CREATE_AN_ISSUE",
    provider: Optional[str] = "composio",
) -> ToolCall:
    return ToolCall(
        data=ToolCallData(
            id="call_run_1",
            function=ToolCallFunction(
                name="gateway.run",
                arguments=ARGUMENTS if arguments is _DEFAULT else arguments,
            ),
        ),
        context=ToolCallContext(
            provider=provider,
            integration=integration,
            connection=connection,
            tool=tool,
            toolkit_version="20250827_00",
        ),
    )


async def _error_of(router: ToolsRouter, body: ToolCall) -> Dict[str, Any]:
    response = await router.call_tool(_request(), body=body)
    assert response.call.status.code == "STATUS_CODE_ERROR"
    return json.loads(response.call.data.content)


# ---------------------------------------------------------------------------
# A17: malformed arguments
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "arguments",
    [
        '{"owner": "agenta-ai"}',
        ["agenta-ai", "agenta"],
        None,
        7,
        "create an issue please",
    ],
)
async def test_arguments_that_are_not_an_object_are_refused(monkeypatch, arguments):
    """A17: the provider is never called with a repaired argument set.

    Replacing malformed input with ``{}`` runs a different call from the one the model
    asked for, and one that can still succeed against the provider.
    """
    provider = FakeProvider()
    router = _router(monkeypatch, provider)

    error = await _error_of(router, _run_call(arguments=arguments))

    assert error["code"] == "invalid_arguments"
    assert error["retryable"] is False
    assert error["next_step"]
    assert provider.requests == []


# ---------------------------------------------------------------------------
# A18, A21: the happy path and where identity comes from
# ---------------------------------------------------------------------------


async def test_valid_arguments_reach_the_provider_unchanged(monkeypatch):
    """A18."""
    provider = FakeProvider()
    router = _router(monkeypatch, provider)

    response = await router.call_tool(_request(), body=_run_call())

    assert response.call.status.code == "STATUS_CODE_OK"
    assert len(provider.requests) == 1
    assert provider.requests[0].arguments == ARGUMENTS
    assert json.loads(response.call.data.content)["data"] == {"number": 7}


async def test_routing_comes_from_the_context_not_the_arguments(monkeypatch):
    """A21: model-supplied lookalike fields are payload, never routing."""
    provider = FakeProvider()
    connection_calls: list = []
    router = _router(monkeypatch, provider, connection_calls=connection_calls)

    decoys = {
        **ARGUMENTS,
        "provider": "evil",
        "integration": "slack",
        "connection": "slack-main",
        "tool": "LOCK_AN_ISSUE",
    }
    request = _request()
    await router.call_tool(request, body=_run_call(arguments=decoys))

    assert connection_calls == [
        {
            "project_id": UUID(request.state.project_id),
            "provider_key": "composio",
            "integration_key": "github",
            "connection_slug": "github-work",
        }
    ]
    executed = provider.requests[0]
    assert executed.integration_key == "github"
    assert executed.action_key == "CREATE_AN_ISSUE"
    # The canonical ID is read from the catalog row, never rebuilt from the two above.
    assert executed.provider_action_id == "GITHUB_CREATE_AN_ISSUE"
    assert executed.provider_connection_id == "acc_1"
    # The decoys stay in the payload: they are the tool's arguments, not routing.
    assert executed.arguments == decoys


async def test_latest_changing_after_resolution_cannot_change_execution(monkeypatch):
    provider = FakeProvider()
    router = _router(monkeypatch, provider)
    service = router.tools_service
    ref = GatewayConnectionTool.model_validate(
        {
            "type": "gateway_connection",
            "connection": {
                "provider": "composio",
                "integration": "github",
                "slug": "github-work",
            },
            "policy": {"permissions": {"default": "allow", "tools": {}}},
        }
    )

    resolved = await service._resolve_gateway_connection(
        project_id=uuid4(),
        ref=ref,
    )
    provider.latest_version = "20250828_00"
    await service.run_gateway_tool(
        project_id=uuid4(),
        provider_key="composio",
        integration_key="github",
        connection_slug="github-work",
        tool_key="CREATE_AN_ISSUE",
        toolkit_version=resolved.toolkit_version,
        arguments=ARGUMENTS,
    )

    assert resolved.toolkit_version == "20250827_00"
    assert provider.requests[0].toolkit_version == "20250827_00"
    assert provider.list_versions
    assert set(provider.list_versions) == {"20250827_00"}


@pytest.mark.parametrize(
    "context",
    [
        None,
        ToolCallContext(provider="composio"),
        ToolCallContext(provider="composio", integration="github"),
        ToolCallContext(
            provider="composio", integration="github", connection="github-work"
        ),
        ToolCallContext(integration="github", connection="github-work", tool="X"),
        # Complete routing, but no version to run it at.
        ToolCallContext(
            provider="composio",
            integration="github",
            connection="github-work",
            tool="CREATE_AN_ISSUE",
        ),
    ],
)
async def test_an_incomplete_context_is_refused(monkeypatch, context):
    """There is no default connection to fall back to, so the call cannot proceed."""
    provider = FakeProvider()
    router = _router(monkeypatch, provider)

    body = ToolCall(
        data=ToolCallData(
            id="call_run_1",
            function=ToolCallFunction(name="gateway.run", arguments=ARGUMENTS),
        ),
        context=context,
    )

    with pytest.raises(HTTPException) as caught:
        await router.call_tool(_request(), body=body)

    assert caught.value.status_code == 400
    assert provider.requests == []


@pytest.mark.parametrize("version", ["latest", "LATEST", " latest ", "", "   "])
def test_a_context_version_that_is_not_concrete_is_refused(version):
    """The alias and a blank both mean "whatever is newest", which never reaches a run.

    This is refused while the body is parsed, so the route never sees the call. A blank
    matters on its own: the route's own check tests truthiness, and a whitespace-only
    version is truthy.
    """
    with pytest.raises(ValidationError):
        ToolCallContext(
            provider="composio",
            integration="github",
            connection="github-work",
            tool="CREATE_AN_ISSUE",
            toolkit_version=version,
        )


def test_a_concrete_context_version_is_kept_trimmed():
    context = ToolCallContext(
        provider="composio",
        integration="github",
        connection="github-work",
        tool="CREATE_AN_ISSUE",
        toolkit_version=" 20250827_00 ",
    )

    assert context.toolkit_version == "20250827_00"


# ---------------------------------------------------------------------------
# A10: project access
# ---------------------------------------------------------------------------


async def test_a_caller_without_run_tools_is_forbidden(monkeypatch):
    """A10: the gateway routes sit behind the same check as every other tool call."""
    provider = FakeProvider()
    router = _router(monkeypatch, provider, allow_access=False)

    with pytest.raises(HTTPException) as caught:
        await router.call_tool(_request(), body=_run_call())

    assert caught.value.status_code == 403
    assert provider.requests == []


# ---------------------------------------------------------------------------
# A11, A15, A16: the tool key must belong to the integration
# ---------------------------------------------------------------------------


async def test_a_tool_from_another_integration_is_rejected(monkeypatch):
    """A11: a provider slug naming another toolkit is a wrong integration, not a typo.

    This is the only cross-integration claim the API can prove: it holds this
    integration's catalog and nothing else. The runner's policy gate catches the rest
    before the callback is made.
    """
    provider = FakeProvider()
    router = _router(monkeypatch, provider)

    error = await _error_of(router, _run_call(tool="SLACK_SEND_MESSAGE"))

    assert error["code"] == "tool_not_in_integration"
    assert error["retryable"] is False
    # Names both, so the model can see which half was wrong.
    assert "SLACK_SEND_MESSAGE" in error["message"]
    assert "github" in error["message"]
    assert provider.requests == []


async def test_this_integrations_own_provider_slug_is_a_typo_not_a_wrong_integration(
    monkeypatch,
):
    """The key names github and the call names github, so only the form is wrong."""
    provider = FakeProvider()
    router = _router(monkeypatch, provider)

    error = await _error_of(router, _run_call(tool="GITHUB_CREATE_AN_ISSUE"))

    assert error["code"] == "tool_not_found"
    assert "CREATE_AN_ISSUE" in error["details"]["suggestions"]


async def test_an_unknown_key_carries_close_keys_from_the_same_integration(monkeypatch):
    """A15 and A16."""
    provider = FakeProvider()
    router = _router(monkeypatch, provider)

    error = await _error_of(router, _run_call(tool="CREATE_ISSUE"))

    assert error["code"] == "tool_not_found"
    suggestions = error["details"]["suggestions"]
    assert "CREATE_AN_ISSUE" in suggestions
    assert 0 < len(suggestions) <= 5
    # A16: every suggestion is a key of the integration in the context.
    catalog_keys = {action.key for action in GITHUB_CATALOG}
    assert set(suggestions) <= catalog_keys


async def test_a_typo_keeps_its_suggestions_even_though_its_prefix_differs(monkeypatch):
    """A near miss is a typo, and close keys are what fixes it.

    Reading the first segment of every wrong key as an integration name would send
    ``CREATE_ISSUE`` down the wrong-integration path and cost the model the one
    suggestion that repairs the call.
    """
    provider = FakeProvider()
    router = _router(monkeypatch, provider)

    error = await _error_of(router, _run_call(tool="CREATE_ISSUE"))

    assert error["code"] == "tool_not_found"
    assert error["details"]["suggestions"]


async def test_an_integration_with_no_catalog_is_not_a_typo(monkeypatch):
    """An unknown integration has no keys to be a near miss of."""
    provider = FakeProvider(catalog=[])
    router = _router(monkeypatch, provider)

    error = await _error_of(router, _run_call(tool="CREATE_AN_ISSUE"))

    assert error["code"] == "tool_not_in_integration"
    assert error["retryable"] is False
    assert provider.requests == []


# ---------------------------------------------------------------------------
# A12, A13, A14: the connection
# ---------------------------------------------------------------------------


async def test_a_connection_outside_the_project_is_rejected(monkeypatch):
    """A12: the lookup is project-scoped, so another project's slug is not found."""
    provider = FakeProvider()
    connection_calls: list = []
    router = _router(
        monkeypatch,
        provider,
        connection_calls=connection_calls,
        connection_error=ConnectionNotFoundError(
            provider_key="composio",
            integration_key="github",
            connection_slug="github-work",
        ),
    )

    request = _request()
    response = await router.call_tool(request, body=_run_call())
    error = json.loads(response.call.data.content)

    assert error["code"] == "connection_unavailable"
    assert connection_calls[0]["project_id"] == UUID(request.state.project_id)
    assert provider.requests == []


@pytest.mark.parametrize(
    "connection_error",
    [
        # A13: revoked connections are stored inactive.
        ConnectionInactiveError(connection_id="github-work"),
        # A14: present but never finished its handshake.
        ConnectionInvalidError(connection_slug="github-work"),
    ],
)
async def test_an_unusable_connection_is_rejected_at_execution(
    monkeypatch, connection_error
):
    """A13 and A14."""
    provider = FakeProvider()
    router = _router(monkeypatch, provider, connection_error=connection_error)

    error = await _error_of(router, _run_call())

    assert error["code"] == "connection_unavailable"
    assert error["retryable"] is False
    assert error["next_step"]
    assert provider.requests == []


# ---------------------------------------------------------------------------
# A20: a provider rejection
# ---------------------------------------------------------------------------


async def test_a_provider_rejection_keeps_its_detail(monkeypatch):
    """A20: the provider's own reason is what lets the model correct the request."""
    provider = FakeProvider(
        response=ToolExecutionResponse(
            data=None,
            error="Validation failed: title is required",
            successful=False,
        )
    )
    router = _router(monkeypatch, provider)

    response = await router.call_tool(_request(), body=_run_call())

    assert response.call.status.code == "STATUS_CODE_ERROR"
    content = json.loads(response.call.data.content)
    assert content["error"] == "Validation failed: title is required"
    assert response.call.status.message == "Validation failed: title is required"


@pytest.mark.parametrize(
    "upstream_status, retryable",
    [
        # The provider refused the request itself, so repeating it cannot work.
        (400, False),
        (422, False),
        # The provider was broken or unreachable; the same bytes may work later.
        (503, True),
        (None, True),
    ],
)
async def test_a_raised_provider_failure_reaches_the_model(
    monkeypatch, upstream_status, retryable
):
    """A20, when the provider fails at the transport rather than answering.

    A 424 would be correct HTTP and useless here: the runner hides a non-2xx body from
    the model, so the provider's reason would never reach the one reader who can act
    on it.
    """
    provider = FakeProvider()
    error = AdapterError(
        provider_key="composio",
        operation="execute",
        detail="Validation failed: title is required",
    )
    if upstream_status is not None:
        response = httpx.Response(
            upstream_status, request=httpx.Request("POST", "https://composio.test")
        )
        error.__cause__ = httpx.HTTPStatusError(
            "boom", request=response.request, response=response
        )

    async def _raise(*, request):
        raise error

    provider.execute = _raise
    router = _router(monkeypatch, provider)

    response = await router.call_tool(_request(), body=_run_call())

    assert response.call.status.code == "STATUS_CODE_ERROR"
    envelope = json.loads(response.call.data.content)
    assert envelope["code"] == "tool_execution_failed"
    assert "title is required" in envelope["message"]
    assert envelope["retryable"] is retryable
    assert envelope["next_step"]


# ---------------------------------------------------------------------------
# The legacy grammar is untouched
# ---------------------------------------------------------------------------


async def test_a_legacy_five_segment_call_still_runs(monkeypatch):
    """The new names sit beside the old grammar; saved revisions keep working."""
    provider = FakeProvider()
    router = _router(monkeypatch, provider)

    body = ToolCall(
        data=ToolCallData(
            id="call_legacy_1",
            function=ToolCallFunction(
                name="tools.composio.github.CREATE_AN_ISSUE.github-work",
                arguments=ARGUMENTS,
            ),
        )
    )
    response = await router.call_tool(_request(), body=body)

    assert response.call.status.code == "STATUS_CODE_OK"
    assert provider.requests[0].provider_action_id == "GITHUB_CREATE_AN_ISSUE"
    assert provider.requests[0].arguments == ARGUMENTS
