"""Unit tests for `LlmGatewayService` (specs-wp7.md, tasks-wp7.md Phases 5, 5b, 6).

Stubbed DAO/policy/resolver/registry — no real adapters, no compose, nothing running.
"""

import json
from typing import AsyncIterator, Dict, List, Optional, Set
from uuid import uuid4

import pytest

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import (
    LlmDeploymentKind,
    LlmEndpoint,
    LlmEndpointConfig,
    LlmEndpointData,
)
from oss.src.core.gateways.llms.interfaces import (
    LlmEndpointsDAOInterface,
    LlmRelayResult,
    LlmUpstreamInterface,
)
from oss.src.core.gateways.llms.registry import LlmUpstreamRegistry
from oss.src.core.gateways.llms.service import LlmGatewayService
from oss.src.core.gateways.llms.types import (
    LlmEndpointNotFoundError,
    LlmModelNotAllowedError,
)
from oss.src.core.gateways.policy.dtos import (
    CredentialMode,
    CredentialOwner,
    CredentialOwnerKind,
    GatewayUsage,
    PolicyDecision,
    ResolvedCredential,
    SecretOrigin,
)
from oss.src.core.gateways.policy.interfaces import CredentialResolverInterface
from oss.src.core.gateways.policy.types import CeilingExceededError, PolicyDeniedError
from oss.src.core.secrets.dtos import (
    SecretResponseDTO,
    StandardProviderDTO,
    StandardProviderSettingsDTO,
)
from oss.src.core.secrets.enums import SecretKind, StandardProviderKind
from oss.src.core.shared.dtos import Header
from oss.src.utils.context import AuthScope


def _scope() -> AuthScope:
    return AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )


def _custom_row(
    *,
    slug="acme",
    provider_key="openai",
    deployment=LlmDeploymentKind.CUSTOM,
    model_slugs=None,
    max_output_tokens=None,
    secret_id=None,
) -> LlmEndpoint:
    return LlmEndpoint(
        id=uuid4(),
        slug=slug,
        provider_key=provider_key,
        deployment=deployment,
        namespace=GatewayEndpointNamespace.CUSTOM,
        secret_id=secret_id,
        data=LlmEndpointData(
            model_slugs=list(model_slugs) if model_slugs is not None else ["gpt-4o"],
            config=LlmEndpointConfig(max_output_tokens=max_output_tokens),
        ),
    )


def _credential() -> ResolvedCredential:
    return ResolvedCredential(
        secret=SecretResponseDTO(
            kind=SecretKind.PROVIDER_KEY,
            data=StandardProviderDTO(
                kind=StandardProviderKind.OPENAI,
                provider=StandardProviderSettingsDTO(key="sk-test"),
            ),
            header=Header(name="openai"),
        ),
        owner=CredentialOwner(kind=CredentialOwnerKind.PROJECT),
        origin=SecretOrigin.VAULT,
    )


class _FakeLlmEndpointsDAO(LlmEndpointsDAOInterface):
    def __init__(self):
        self.calls: List[tuple] = []
        self.rows_by_slug: Dict[str, LlmEndpoint] = {}
        self.query_result: List[LlmEndpoint] = []
        self.create_result: Optional[LlmEndpoint] = None
        self.fetch_result: Optional[LlmEndpoint] = None
        self.edit_result: Optional[LlmEndpoint] = None
        self.delete_result: bool = True

    async def create_endpoint(self, *, project_id, user_id, endpoint):
        self.calls.append(("create_endpoint", project_id, user_id, endpoint))
        return self.create_result

    async def fetch_endpoint(self, *, project_id, endpoint_id):
        self.calls.append(("fetch_endpoint", project_id, endpoint_id))
        return self.fetch_result

    async def fetch_endpoint_by_slug(self, *, project_id, slug):
        self.calls.append(("fetch_endpoint_by_slug", project_id, slug))
        return self.rows_by_slug.get(slug)

    async def edit_endpoint(self, *, project_id, user_id, endpoint):
        self.calls.append(("edit_endpoint", project_id, user_id, endpoint))
        return self.edit_result

    async def delete_endpoint(self, *, project_id, endpoint_id):
        self.calls.append(("delete_endpoint", project_id, endpoint_id))
        return self.delete_result

    async def query_endpoints(self, *, project_id, endpoint=None, windowing=None):
        self.calls.append(("query_endpoints", project_id, endpoint, windowing))
        return self.query_result


class _FakeResolver(CredentialResolverInterface):
    def __init__(
        self,
        *,
        provider_keys: Optional[Set[str]] = None,
        credential: Optional[ResolvedCredential] = None,
    ):
        self.provider_keys = provider_keys or set()
        self.credential = credential
        self.resolve_calls: List[tuple] = []

    async def resolve(self, *, scope, ref, mode):
        self.resolve_calls.append((scope, ref, mode))
        assert self.credential is not None, (
            "resolve() called with no credential stubbed"
        )
        return self.credential

    async def available_provider_keys(self, *, scope) -> Set[str]:
        return self.provider_keys


class _FakePolicy:
    def __init__(self, *, allowed: bool = True):
        self.allowed = allowed
        self.authorize_calls: List[tuple] = []
        self.record_calls: List[tuple] = []

    async def authorize(self, *, scope, permission, target):
        self.authorize_calls.append((scope, permission, target))
        return PolicyDecision(
            allowed=self.allowed,
            permission=permission,
            reason=None if self.allowed else "permission_denied",
        )

    async def record(self, *, scope, target, decision, outcome):
        self.record_calls.append((scope, target, decision, outcome))


class _FakeAdapter(LlmUpstreamInterface):
    def __init__(self, *, result: LlmRelayResult):
        self.result = result
        self.calls: List[dict] = []

    async def relay_chat_completion(self, *, route, credential, context, body, headers):
        self.calls.append(
            {
                "route": route,
                "credential": credential,
                "context": context,
                "body": body,
                "headers": headers,
            }
        )
        return self.result


async def _one_chunk_body(data: bytes) -> AsyncIterator[bytes]:
    yield data


def _service(
    *, dao=None, policy=None, resolver=None, registry=None
) -> LlmGatewayService:
    return LlmGatewayService(
        llm_endpoints_dao=dao if dao is not None else _FakeLlmEndpointsDAO(),
        policy=policy if policy is not None else _FakePolicy(),
        resolver=resolver if resolver is not None else _FakeResolver(),
        upstream_registry=registry
        if registry is not None
        else LlmUpstreamRegistry(adapters={}),
    )


# --- management: thin delegation ------------------------------------------- #


@pytest.mark.asyncio
async def test_create_endpoint_delegates_to_dao_unchanged():
    dao = _FakeLlmEndpointsDAO()
    dao.create_result = _custom_row()
    project_id, user_id = uuid4(), uuid4()
    endpoint_create = object()

    result = await _service(dao=dao).create_endpoint(
        project_id=project_id, user_id=user_id, endpoint=endpoint_create
    )

    assert result is dao.create_result
    assert dao.calls == [("create_endpoint", project_id, user_id, endpoint_create)]


@pytest.mark.asyncio
async def test_fetch_endpoint_delegates_to_dao_unchanged():
    dao = _FakeLlmEndpointsDAO()
    dao.fetch_result = _custom_row()
    project_id, endpoint_id = uuid4(), uuid4()

    result = await _service(dao=dao).fetch_endpoint(
        project_id=project_id, endpoint_id=endpoint_id
    )

    assert result is dao.fetch_result
    assert dao.calls == [("fetch_endpoint", project_id, endpoint_id)]


@pytest.mark.asyncio
async def test_edit_endpoint_delegates_to_dao_unchanged():
    dao = _FakeLlmEndpointsDAO()
    dao.edit_result = _custom_row()
    project_id, user_id = uuid4(), uuid4()
    endpoint_edit = object()

    result = await _service(dao=dao).edit_endpoint(
        project_id=project_id, user_id=user_id, endpoint=endpoint_edit
    )

    assert result is dao.edit_result
    assert dao.calls == [("edit_endpoint", project_id, user_id, endpoint_edit)]


@pytest.mark.asyncio
async def test_delete_endpoint_delegates_to_dao_unchanged():
    dao = _FakeLlmEndpointsDAO()
    project_id, endpoint_id = uuid4(), uuid4()

    result = await _service(dao=dao).delete_endpoint(
        project_id=project_id, endpoint_id=endpoint_id
    )

    assert result is True
    assert dao.calls == [("delete_endpoint", project_id, endpoint_id)]


@pytest.mark.asyncio
async def test_query_endpoints_delegates_to_dao_unchanged():
    dao = _FakeLlmEndpointsDAO()
    dao.query_result = [_custom_row()]
    project_id = uuid4()

    result = await _service(dao=dao).query_endpoints(project_id=project_id)

    assert result is dao.query_result
    assert dao.calls == [("query_endpoints", project_id, None, None)]


# --- list_endpoints: the merge (D20) ---------------------------------------- #


@pytest.mark.asyncio
async def test_list_endpoints_merges_generated_and_custom_with_two_keys():
    dao = _FakeLlmEndpointsDAO()
    custom_row = _custom_row(slug="acme")
    dao.query_result = [custom_row]
    resolver = _FakeResolver(provider_keys={"openai", "anthropic"})

    result = await _service(dao=dao, resolver=resolver).list_endpoints(scope=_scope())

    generated = [e for e in result if e.namespace == GatewayEndpointNamespace.BUILTIN]
    assert {e.provider_key for e in generated} == {"openai", "anthropic"}
    assert custom_row in result
    assert len(result) == len(generated) + 1


@pytest.mark.asyncio
async def test_list_endpoints_with_no_keys_yields_custom_rows_only():
    dao = _FakeLlmEndpointsDAO()
    custom_row = _custom_row(slug="acme")
    dao.query_result = [custom_row]
    resolver = _FakeResolver(provider_keys=set())

    result = await _service(dao=dao, resolver=resolver).list_endpoints(scope=_scope())

    assert result == [custom_row]


# --- list_models (R3) ------------------------------------------------------- #


@pytest.mark.asyncio
async def test_list_models_custom_returns_model_slugs_exactly():
    dao = _FakeLlmEndpointsDAO()
    dao.rows_by_slug["acme"] = _custom_row(slug="acme", model_slugs=["a", "b"])

    slugs = await _service(dao=dao).list_models(
        scope=_scope(), namespace=GatewayEndpointNamespace.CUSTOM, name="acme"
    )

    assert slugs == ["a", "b"]


@pytest.mark.asyncio
async def test_list_models_builtin_returns_catalogue_slugs_verbatim():
    from agenta.sdk.utils.assets import supported_llm_models

    slugs = await _service().list_models(
        scope=_scope(), namespace=GatewayEndpointNamespace.BUILTIN, name="anthropic"
    )

    assert slugs == supported_llm_models["anthropic"]


@pytest.mark.asyncio
async def test_list_models_unknown_name_raises_not_found():
    with pytest.raises(LlmEndpointNotFoundError):
        await _service().list_models(
            scope=_scope(), namespace=GatewayEndpointNamespace.CUSTOM, name="ghost"
        )


@pytest.mark.asyncio
async def test_list_models_denied_decision_raises_before_reading_slugs():
    dao = _FakeLlmEndpointsDAO()
    dao.rows_by_slug["acme"] = _custom_row(slug="acme", model_slugs=["a"])
    policy = _FakePolicy(allowed=False)

    with pytest.raises(PolicyDeniedError):
        await _service(dao=dao, policy=policy).list_models(
            scope=_scope(), namespace=GatewayEndpointNamespace.CUSTOM, name="acme"
        )
    assert len(policy.authorize_calls) == 1


# --- relay_chat_completion: the three orderings ----------------------------- #


@pytest.mark.asyncio
async def test_disallowed_model_raises_without_calling_resolver():
    dao = _FakeLlmEndpointsDAO()
    dao.rows_by_slug["acme"] = _custom_row(slug="acme", model_slugs=["gpt-4o"])
    resolver = _FakeResolver(credential=_credential())

    body = json.dumps({"model": "gpt-4o-mini", "messages": []}).encode()

    with pytest.raises(LlmModelNotAllowedError):
        await _service(dao=dao, resolver=resolver).relay_chat_completion(
            scope=_scope(),
            namespace=GatewayEndpointNamespace.CUSTOM,
            name="acme",
            body=body,
            headers={},
        )

    assert resolver.resolve_calls == []


@pytest.mark.asyncio
async def test_policy_denial_records_once_before_raising():
    dao = _FakeLlmEndpointsDAO()
    dao.rows_by_slug["acme"] = _custom_row(slug="acme", model_slugs=["gpt-4o"])
    policy = _FakePolicy(allowed=False)
    resolver = _FakeResolver(credential=_credential())

    body = json.dumps({"model": "gpt-4o", "messages": []}).encode()

    with pytest.raises(PolicyDeniedError):
        await _service(dao=dao, policy=policy, resolver=resolver).relay_chat_completion(
            scope=_scope(),
            namespace=GatewayEndpointNamespace.CUSTOM,
            name="acme",
            body=body,
            headers={},
        )

    assert len(policy.record_calls) == 1
    outcome = policy.record_calls[0][3]
    assert outcome.status_code == 403
    assert resolver.resolve_calls == []


@pytest.mark.asyncio
async def test_ceiling_breach_names_all_three_values():
    dao = _FakeLlmEndpointsDAO()
    dao.rows_by_slug["acme"] = _custom_row(
        slug="acme", model_slugs=["gpt-4o"], max_output_tokens=100
    )
    resolver = _FakeResolver(credential=_credential())

    body = json.dumps(
        {"model": "gpt-4o", "messages": [], "max_output_tokens": 200}
    ).encode()

    with pytest.raises(CeilingExceededError) as excinfo:
        await _service(dao=dao, resolver=resolver).relay_chat_completion(
            scope=_scope(),
            namespace=GatewayEndpointNamespace.CUSTOM,
            name="acme",
            body=body,
            headers={},
        )

    assert excinfo.value.ceiling == "max_output_tokens"
    assert excinfo.value.requested == 200
    assert excinfo.value.allowed == 100
    assert resolver.resolve_calls == []


@pytest.mark.asyncio
async def test_successful_non_streaming_call_records_after_relay():
    dao = _FakeLlmEndpointsDAO()
    row = _custom_row(slug="acme", model_slugs=["gpt-4o"], secret_id=uuid4())
    dao.rows_by_slug["acme"] = row
    credential = _credential()
    resolver = _FakeResolver(credential=credential)

    adapter_result = LlmRelayResult(
        status_code=200,
        headers={},
        body=_one_chunk_body(b'{"ok": true}'),
        usage=GatewayUsage(calls=1, input_tokens=3, output_tokens=4, cost=0.01),
    )
    adapter = _FakeAdapter(result=adapter_result)
    registry = LlmUpstreamRegistry(adapters={"passthrough": adapter})
    policy = _FakePolicy(allowed=True)

    body = json.dumps({"model": "gpt-4o", "messages": []}).encode()
    result = await _service(
        dao=dao, resolver=resolver, registry=registry, policy=policy
    ).relay_chat_completion(
        scope=_scope(),
        namespace=GatewayEndpointNamespace.CUSTOM,
        name="acme",
        body=body,
        headers={},
    )

    assert result is adapter_result
    assert len(adapter.calls) == 1
    assert resolver.resolve_calls[0][2] == CredentialMode.PROJECT_ONLY
    assert len(policy.record_calls) == 1
    outcome = policy.record_calls[0][3]
    assert outcome.status_code == 200
    assert outcome.usage.input_tokens == 3
    assert outcome.owner == credential.owner


@pytest.mark.asyncio
async def test_streaming_call_records_only_after_full_consumption():
    dao = _FakeLlmEndpointsDAO()
    dao.rows_by_slug["acme"] = _custom_row(
        slug="acme", model_slugs=["gpt-4o"], secret_id=uuid4()
    )
    resolver = _FakeResolver(credential=_credential())
    policy = _FakePolicy(allowed=True)

    async def _two_chunks() -> AsyncIterator[bytes]:
        yield b"chunk-1"
        yield b"chunk-2"

    adapter_result = LlmRelayResult(status_code=200, headers={}, body=_two_chunks())
    adapter = _FakeAdapter(result=adapter_result)
    registry = LlmUpstreamRegistry(adapters={"passthrough": adapter})

    body = json.dumps({"model": "gpt-4o", "messages": [], "stream": True}).encode()
    result = await _service(
        dao=dao, resolver=resolver, registry=registry, policy=policy
    ).relay_chat_completion(
        scope=_scope(),
        namespace=GatewayEndpointNamespace.CUSTOM,
        name="acme",
        body=body,
        headers={},
    )

    assert policy.record_calls == []  # nothing recorded before the body is drained

    first = await result.body.__anext__()
    assert first == b"chunk-1"
    assert policy.record_calls == []  # still nothing after a partial read

    remaining = [chunk async for chunk in result.body]
    assert remaining == [b"chunk-2"]
    assert len(policy.record_calls) == 1  # recorded exactly once, after exhaustion
