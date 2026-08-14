"""Unit tests for `LLMGatewayService` (specs-wp7.md, tasks-wp7.md Phases 5, 5b, 6).

Stubbed DAO/policy/resolver/registry — no real adapters, no compose, nothing running.
"""

import json
from typing import AsyncIterator, Dict, List, Optional, Set
from uuid import uuid4

import pytest

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMEndpoint,
    LLMEndpointData,
    LLMEndpointSettings,
    LLMModelFilter,
    LLMProtocol,
)
from oss.src.core.gateways.llms.interfaces import (
    LLMEndpointsDAOInterface,
    LLMRelayResult,
    LLMUpstreamInterface,
)
from oss.src.core.gateways.llms.registry import LLMUpstreamRegistry
from oss.src.core.gateways.llms.service import LLMGatewayService
from oss.src.core.gateways.llms.types import (
    LLMEndpointNotFoundError,
    LLMModelNotAllowedError,
)
from oss.src.core.gateways.policy.dtos import (
    SecretMode,
    SecretOwner,
    SecretOwnerKind,
    GatewayUsage,
    PolicyDecision,
    ResolvedSecret,
    SecretOrigin,
)
from oss.src.core.gateways.policy.interfaces import SecretsResolverInterface
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
    deployment_kind=LLMDeploymentKind.CUSTOM,
    models=None,
    max_output_tokens=None,
    secret_id=None,
) -> LLMEndpoint:
    return LLMEndpoint(
        id=uuid4(),
        slug=slug,
        provider_key=provider_key,
        deployment_kind=deployment_kind,
        namespace=GatewayEndpointNamespace.CUSTOM,
        secret_id=secret_id,
        data=LLMEndpointData(
            models=models or LLMModelFilter(allowlist=["gpt-4o"]),
            settings=LLMEndpointSettings(max_output_tokens=max_output_tokens),
        ),
    )


def _secret() -> ResolvedSecret:
    return ResolvedSecret(
        secret=SecretResponseDTO(
            kind=SecretKind.PROVIDER_KEY,
            data=StandardProviderDTO(
                kind=StandardProviderKind.OPENAI,
                provider=StandardProviderSettingsDTO(key="sk-test"),
            ),
            header=Header(name="openai"),
        ),
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
        origin=SecretOrigin.VAULT,
    )


class _MockLlmEndpointsDAO(LLMEndpointsDAOInterface):
    def __init__(self):
        self.calls: List[tuple] = []
        self.rows_by_slug: Dict[str, LLMEndpoint] = {}
        self.query_result: List[LLMEndpoint] = []
        self.create_result: Optional[LLMEndpoint] = None
        self.fetch_result: Optional[LLMEndpoint] = None
        self.edit_result: Optional[LLMEndpoint] = None
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


class _MockResolver(SecretsResolverInterface):
    def __init__(
        self,
        *,
        provider_keys: Optional[Set[str]] = None,
        secret: Optional[ResolvedSecret] = None,
    ):
        self.provider_keys = provider_keys or set()
        self.secret = secret
        self.resolve_calls: List[tuple] = []

    async def resolve(self, *, scope, ref, mode):
        self.resolve_calls.append((scope, ref, mode))
        assert self.secret is not None, "resolve() called with no secret stubbed"
        return self.secret

    async def available_provider_keys(self, *, scope) -> Set[str]:
        return self.provider_keys


class _MockPolicy:
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


class _MockAdapter(LLMUpstreamInterface):
    def __init__(self, *, result: LLMRelayResult):
        self.result = result
        self.calls: List[dict] = []

    async def relay_chat_completion(self, *, route, secret, context, body, headers):
        self.calls.append(
            {
                "route": route,
                "secret": secret,
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
) -> LLMGatewayService:
    return LLMGatewayService(
        llm_endpoints_dao=dao if dao is not None else _MockLlmEndpointsDAO(),
        policy=policy if policy is not None else _MockPolicy(),
        resolver=resolver if resolver is not None else _MockResolver(),
        upstream_registry=registry
        if registry is not None
        else LLMUpstreamRegistry(adapters={}),
    )


# --- management: thin delegation ------------------------------------------- #


@pytest.mark.asyncio
async def test_create_endpoint_delegates_to_dao_unchanged():
    dao = _MockLlmEndpointsDAO()
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
    dao = _MockLlmEndpointsDAO()
    dao.fetch_result = _custom_row()
    project_id, endpoint_id = uuid4(), uuid4()

    result = await _service(dao=dao).fetch_endpoint(
        project_id=project_id, endpoint_id=endpoint_id
    )

    assert result is dao.fetch_result
    assert dao.calls == [("fetch_endpoint", project_id, endpoint_id)]


@pytest.mark.asyncio
async def test_edit_endpoint_delegates_to_dao_unchanged():
    dao = _MockLlmEndpointsDAO()
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
    dao = _MockLlmEndpointsDAO()
    project_id, endpoint_id = uuid4(), uuid4()

    result = await _service(dao=dao).delete_endpoint(
        project_id=project_id, endpoint_id=endpoint_id
    )

    assert result is True
    assert dao.calls == [("delete_endpoint", project_id, endpoint_id)]


@pytest.mark.asyncio
async def test_query_endpoints_delegates_to_dao_unchanged():
    dao = _MockLlmEndpointsDAO()
    dao.query_result = [_custom_row()]
    project_id = uuid4()

    result = await _service(dao=dao).query_endpoints(project_id=project_id)

    assert result is dao.query_result
    assert dao.calls == [("query_endpoints", project_id, None, None)]


# --- list_endpoints: the merge (D20) ---------------------------------------- #


@pytest.mark.asyncio
async def test_list_endpoints_merges_generated_and_custom_with_two_keys():
    dao = _MockLlmEndpointsDAO()
    custom_row = _custom_row(slug="acme")
    dao.query_result = [custom_row]
    resolver = _MockResolver(provider_keys={"openai", "anthropic"})

    result = await _service(dao=dao, resolver=resolver).list_endpoints(scope=_scope())

    generated = [e for e in result if e.namespace == GatewayEndpointNamespace.STANDARD]
    assert {e.provider_key for e in generated} == {"openai", "anthropic"}
    assert custom_row in result
    assert len(result) == len(generated) + 1


@pytest.mark.asyncio
async def test_list_endpoints_with_no_keys_yields_custom_rows_only():
    dao = _MockLlmEndpointsDAO()
    custom_row = _custom_row(slug="acme")
    dao.query_result = [custom_row]
    resolver = _MockResolver(provider_keys=set())

    result = await _service(dao=dao, resolver=resolver).list_endpoints(scope=_scope())

    assert result == [custom_row]


# --- list_models (R3) ------------------------------------------------------- #


@pytest.mark.asyncio
async def test_list_models_custom_returns_the_allowlist_exactly():
    dao = _MockLlmEndpointsDAO()
    dao.rows_by_slug["acme"] = _custom_row(
        slug="acme", models=LLMModelFilter(allowlist=["a", "b"])
    )

    slugs = await _service(dao=dao).list_models(
        scope=_scope(), namespace=GatewayEndpointNamespace.CUSTOM, name="acme"
    )

    assert slugs == ["a", "b"]


@pytest.mark.asyncio
async def test_list_models_standard_returns_catalogue_slugs_verbatim():
    from agenta.sdk.utils.assets import supported_llm_models

    slugs = await _service().list_models(
        scope=_scope(), namespace=GatewayEndpointNamespace.STANDARD, name="anthropic"
    )

    assert slugs == supported_llm_models["anthropic"]


@pytest.mark.asyncio
async def test_list_models_unknown_name_raises_not_found():
    with pytest.raises(LLMEndpointNotFoundError):
        await _service().list_models(
            scope=_scope(), namespace=GatewayEndpointNamespace.CUSTOM, name="ghost"
        )


@pytest.mark.asyncio
async def test_list_models_denied_decision_raises_before_reading_slugs():
    dao = _MockLlmEndpointsDAO()
    dao.rows_by_slug["acme"] = _custom_row(
        slug="acme", models=LLMModelFilter(allowlist=["a"])
    )
    policy = _MockPolicy(allowed=False)

    with pytest.raises(PolicyDeniedError):
        await _service(dao=dao, policy=policy).list_models(
            scope=_scope(), namespace=GatewayEndpointNamespace.CUSTOM, name="acme"
        )
    assert len(policy.authorize_calls) == 1


# --- relay_chat_completion: the three orderings ----------------------------- #


@pytest.mark.asyncio
async def test_disallowed_model_raises_without_calling_resolver():
    dao = _MockLlmEndpointsDAO()
    dao.rows_by_slug["acme"] = _custom_row(
        slug="acme", models=LLMModelFilter(allowlist=["gpt-4o"])
    )
    resolver = _MockResolver(secret=_secret())

    body = json.dumps({"model": "gpt-4o-mini", "messages": []}).encode()

    with pytest.raises(LLMModelNotAllowedError):
        await _service(dao=dao, resolver=resolver).relay_chat_completion(
            scope=_scope(),
            namespace=GatewayEndpointNamespace.CUSTOM,
            name="acme",
            body=body,
            headers={},
        )

    assert resolver.resolve_calls == []


@pytest.mark.parametrize(
    "protocol",
    [LLMProtocol.CHAT_COMPLETIONS, LLMProtocol.RESPONSES, LLMProtocol.MESSAGES],
)
@pytest.mark.asyncio
async def test_disallowed_model_is_refused_on_every_door_before_the_secret(protocol):
    dao = _MockLlmEndpointsDAO()
    dao.rows_by_slug["acme"] = _custom_row(
        slug="acme", models=LLMModelFilter(allowlist=["gpt-4o"])
    )
    resolver = _MockResolver(secret=_secret())

    body = json.dumps({"model": "gpt-4o-mini"}).encode()

    with pytest.raises(LLMModelNotAllowedError):
        await _service(dao=dao, resolver=resolver).relay_chat_completion(
            scope=_scope(),
            namespace=GatewayEndpointNamespace.CUSTOM,
            name="acme",
            body=body,
            headers={},
            protocol=protocol,
        )

    assert resolver.resolve_calls == []


@pytest.mark.asyncio
async def test_policy_denial_records_once_before_raising():
    dao = _MockLlmEndpointsDAO()
    dao.rows_by_slug["acme"] = _custom_row(
        slug="acme", models=LLMModelFilter(allowlist=["gpt-4o"])
    )
    policy = _MockPolicy(allowed=False)
    resolver = _MockResolver(secret=_secret())

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
    dao = _MockLlmEndpointsDAO()
    dao.rows_by_slug["acme"] = _custom_row(
        slug="acme", models=LLMModelFilter(allowlist=["gpt-4o"]), max_output_tokens=100
    )
    resolver = _MockResolver(secret=_secret())

    # Chat Completions' request field is `max_tokens`, not the `max_output_tokens`
    # config key (D33: which request field varies per protocol; the ceiling itself
    # is always named `max_output_tokens` in the error).
    body = json.dumps({"model": "gpt-4o", "messages": [], "max_tokens": 200}).encode()

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


# --- ceiling binding is per protocol (D33, D34, WP23) ------------------------ #


@pytest.mark.parametrize(
    "protocol,field",
    [
        (LLMProtocol.CHAT_COMPLETIONS, "max_tokens"),
        (LLMProtocol.CHAT_COMPLETIONS, "max_completion_tokens"),
        (LLMProtocol.RESPONSES, "max_output_tokens"),
        (LLMProtocol.MESSAGES, "max_tokens"),
    ],
)
@pytest.mark.asyncio
async def test_ceiling_binds_to_the_protocols_own_field_and_rejects_above_it(
    protocol, field
):
    dao = _MockLlmEndpointsDAO()
    dao.rows_by_slug["acme"] = _custom_row(
        slug="acme", models=LLMModelFilter(allowlist=["gpt-4o"]), max_output_tokens=100
    )
    resolver = _MockResolver(secret=_secret())

    body = json.dumps({"model": "gpt-4o", field: 200}).encode()

    with pytest.raises(CeilingExceededError) as excinfo:
        await _service(dao=dao, resolver=resolver).relay_chat_completion(
            scope=_scope(),
            namespace=GatewayEndpointNamespace.CUSTOM,
            name="acme",
            body=body,
            headers={},
            protocol=protocol,
        )

    assert excinfo.value.requested == 200
    assert excinfo.value.allowed == 100
    assert resolver.resolve_calls == []


@pytest.mark.parametrize(
    "protocol,field",
    [
        (LLMProtocol.CHAT_COMPLETIONS, "max_tokens"),
        (LLMProtocol.RESPONSES, "max_output_tokens"),
        (LLMProtocol.MESSAGES, "max_tokens"),
    ],
)
@pytest.mark.asyncio
async def test_ceiling_at_or_below_the_limit_is_not_rejected(protocol, field):
    dao = _MockLlmEndpointsDAO()
    dao.rows_by_slug["acme"] = _custom_row(
        slug="acme", models=LLMModelFilter(allowlist=["gpt-4o"]), max_output_tokens=100
    )
    secret = _secret()
    resolver = _MockResolver(secret=secret)

    adapter_result = LLMRelayResult(
        status_code=200, headers={}, body=_one_chunk_body(b"{}")
    )
    adapter = _MockAdapter(result=adapter_result)
    registry = LLMUpstreamRegistry(adapters={"passthrough": adapter})
    policy = _MockPolicy(allowed=True)

    body = json.dumps({"model": "gpt-4o", field: 100}).encode()

    result = await _service(
        dao=dao, resolver=resolver, registry=registry, policy=policy
    ).relay_chat_completion(
        scope=_scope(),
        namespace=GatewayEndpointNamespace.CUSTOM,
        name="acme",
        body=body,
        headers={},
        protocol=protocol,
    )

    assert result is adapter_result


@pytest.mark.asyncio
async def test_ceiling_ignores_another_protocols_field_name():
    # A Responses body naming `max_tokens` (Chat Completions'/Messages' field) is not
    # mistaken for the ceiling field — RESPONSES only reads `max_output_tokens`.
    dao = _MockLlmEndpointsDAO()
    dao.rows_by_slug["acme"] = _custom_row(
        slug="acme", models=LLMModelFilter(allowlist=["gpt-4o"]), max_output_tokens=100
    )
    secret = _secret()
    resolver = _MockResolver(secret=secret)

    adapter_result = LLMRelayResult(
        status_code=200, headers={}, body=_one_chunk_body(b"{}")
    )
    adapter = _MockAdapter(result=adapter_result)
    registry = LLMUpstreamRegistry(adapters={"passthrough": adapter})
    policy = _MockPolicy(allowed=True)

    body = json.dumps({"model": "gpt-4o", "max_tokens": 999}).encode()

    result = await _service(
        dao=dao, resolver=resolver, registry=registry, policy=policy
    ).relay_chat_completion(
        scope=_scope(),
        namespace=GatewayEndpointNamespace.CUSTOM,
        name="acme",
        body=body,
        headers={},
        protocol=LLMProtocol.RESPONSES,
    )

    assert result is adapter_result


@pytest.mark.asyncio
async def test_successful_non_streaming_call_records_after_relay():
    dao = _MockLlmEndpointsDAO()
    row = _custom_row(
        slug="acme", models=LLMModelFilter(allowlist=["gpt-4o"]), secret_id=uuid4()
    )
    dao.rows_by_slug["acme"] = row
    secret = _secret()
    resolver = _MockResolver(secret=secret)

    adapter_result = LLMRelayResult(
        status_code=200,
        headers={},
        body=_one_chunk_body(b'{"ok": true}'),
        usage=GatewayUsage(calls=1, input_tokens=3, output_tokens=4, cost=0.01),
    )
    adapter = _MockAdapter(result=adapter_result)
    registry = LLMUpstreamRegistry(adapters={"passthrough": adapter})
    policy = _MockPolicy(allowed=True)

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
    assert resolver.resolve_calls[0][2] == SecretMode.PROJECT_ONLY

    # Adapters fill usage while the body generator runs, so recording waits for the
    # drain here exactly as it does for a stream.
    assert policy.record_calls == []
    assert [chunk async for chunk in result.body] == [b'{"ok": true}']

    assert len(policy.record_calls) == 1
    outcome = policy.record_calls[0][3]
    assert outcome.status_code == 200
    assert outcome.usage.input_tokens == 3
    assert outcome.owner == secret.owner


@pytest.mark.asyncio
async def test_streaming_call_records_only_after_full_consumption():
    dao = _MockLlmEndpointsDAO()
    dao.rows_by_slug["acme"] = _custom_row(
        slug="acme", models=LLMModelFilter(allowlist=["gpt-4o"]), secret_id=uuid4()
    )
    resolver = _MockResolver(secret=_secret())
    policy = _MockPolicy(allowed=True)

    async def _two_chunks() -> AsyncIterator[bytes]:
        yield b"chunk-1"
        yield b"chunk-2"

    adapter_result = LLMRelayResult(status_code=200, headers={}, body=_two_chunks())
    adapter = _MockAdapter(result=adapter_result)
    registry = LLMUpstreamRegistry(adapters={"passthrough": adapter})

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
