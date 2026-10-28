"""A person's own provider key through the LLM gateway (M7).

The LLM gateway service over a real LLM-plane `SecretsResolver` and `VaultService`
(in-memory DAO). The run's signed bindings decide; a refusal never falls back.
"""

from contextlib import contextmanager
from uuid import uuid4

import pytest

import oss.src.core.credentials.policy as policy_module
import oss.src.core.secrets.services as services_module
from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.credentials.bindings import Binding, BindingClaim, ConnectionKey
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.registry import LLMUpstreamRegistry
from oss.src.core.gateways.llms.service import LLMGatewayService
from oss.src.core.gateways.llms.types import (
    LLMEndpointNotFoundError,
    LLMPersonalCredentialError,
)
from oss.src.core.gateways.policy.dtos import GatewayPlane
from oss.src.core.gateways.policy.resolution import SecretsResolver
from oss.src.core.secrets.dtos import CreateSecretDTO
from oss.src.core.secrets.enums import SecretOwnerKind
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.types import PersonalSecretKindNotSupported
from oss.tests.pytest.utils.organization_secrets import (
    InMemorySecretsDAO,
    install_cache_engine,
    make_auth_scope,
)
from oss.tests.pytest.utils.principals import make_envelope, make_request_access

OPENAI = ConnectionKey(kind="model", service="openai")
CALLER_OPENAI = BindingClaim(key=OPENAI, binding=Binding.CALLER_ACCOUNT)


class _NoEndpoints:
    async def fetch_endpoint_by_slug(self, **kwargs):
        return None

    async def query_endpoints(self, **kwargs):
        return []


@pytest.fixture
def world(monkeypatch):
    install_cache_engine(monkeypatch)

    async def no_publish(**kwargs):
        return None

    monkeypatch.setattr(services_module, "_safe_publish", no_publish)
    monkeypatch.setattr(
        policy_module.env.agenta.access, "personal_credentials_enabled", True
    )
    monkeypatch.setattr(policy_module, "is_ee", lambda: False)
    organization_id, project_id = uuid4(), uuid4()
    vault = VaultService(InMemorySecretsDAO(projects={project_id: organization_id}))
    service = LLMGatewayService(
        llm_endpoints_dao=_NoEndpoints(),
        policy=None,
        resolver=SecretsResolver(vault_service=vault, plane=GatewayPlane.LLM),
        upstream_registry=LLMUpstreamRegistry(adapters={}),
    )
    return dict(
        vault=vault,
        service=service,
        organization_id=organization_id,
        project_id=project_id,
        scope=make_auth_scope(organization_id=organization_id, project_id=project_id),
    )


@contextmanager
def _run(world, *, kind="human", principal_id=None, linked_user_id=None, bindings=()):
    envelope = make_envelope(
        kind=kind,
        principal_id=principal_id,
        organization_id=world["organization_id"],
        project_id=world["project_id"],
        linked_user_id=linked_user_id,
        origin="installation" if kind == "installation" else "web",
    )
    access = make_request_access(
        envelope=envelope, credential_kind="run_credential"
    ).model_copy(update={"bindings": tuple(bindings)})
    token = set_request_access(access)
    try:
        yield access
    finally:
        reset_request_access(token)


async def _personal_key(world, user_id, *, key="alice-fake"):
    return await world["vault"].create_personal_secret(
        organization_id=world["organization_id"],
        user_id=user_id,
        create_secret_dto=CreateSecretDTO.model_validate(
            {
                "header": {"name": None},
                "secret": {
                    "kind": "provider_key",
                    "data": {"kind": "openai", "provider": {"key": key}},
                },
                "scope": "user",
            }
        ),
    )


async def test_a_personal_key_is_one_per_provider_with_the_provider_as_slug(world):
    alice = uuid4()
    secret = await _personal_key(world, alice)
    assert secret.slug == "openai"
    assert secret.owner.kind == SecretOwnerKind.USER
    assert secret.owner.id == alice
    assert secret.owner.organization_id == world["organization_id"]
    with pytest.raises(Exception):
        await _personal_key(world, alice)


async def test_only_provider_keys_are_personal(world):
    with pytest.raises(PersonalSecretKindNotSupported):
        await world["vault"].create_personal_secret(
            organization_id=world["organization_id"],
            user_id=uuid4(),
            create_secret_dto=CreateSecretDTO.model_validate(
                {
                    "header": {"name": "token"},
                    "secret": {
                        "kind": "custom_secret",
                        "data": {"secret": {"format": "text", "content": "x"}},
                    },
                    "slug": "token",
                    "scope": "user",
                }
            ),
        )


async def test_a_bound_model_connection_resolves_to_the_persons_own_key(world):
    alice = uuid4()
    secret = await _personal_key(world, alice)
    with _run(world, principal_id=alice, bindings=[CALLER_OPENAI]):
        resolved = await world["service"].resolve_agent_connection(
            scope=world["scope"],
            model="gpt-4o-mini",
            provider_key="openai",
            connection_slug=None,
        )
        assert resolved.namespace == GatewayEndpointNamespace.USER
        assert resolved.name == "openai"
        target = await world["service"]._resolve_target(
            scope=world["scope"], namespace=GatewayEndpointNamespace.USER, name="openai"
        )
    assert target.resolved_secret.secret.id == secret.id
    assert target.resolved_secret.owner.kind == SecretOwnerKind.USER


async def test_two_people_each_get_their_own_key(world):
    alice, bob = uuid4(), uuid4()
    alice_key = await _personal_key(world, alice, key="alice-fake")
    bob_key = await _personal_key(world, bob, key="bob-fake")
    for person, expected in ((alice, alice_key), (bob, bob_key)):
        with _run(world, principal_id=person, bindings=[CALLER_OPENAI]):
            target = await world["service"]._resolve_target(
                scope=world["scope"],
                namespace=GatewayEndpointNamespace.USER,
                name="openai",
            )
        assert target.resolved_secret.secret.id == expected.id


async def test_sandbox_cannot_ask_for_a_personal_key_without_the_binding(world):
    alice = uuid4()
    await _personal_key(world, alice)
    with _run(world, principal_id=alice, bindings=()):
        # The resolve answers the project's shared account, as under M5.
        resolved = await world["service"].resolve_agent_connection(
            scope=world["scope"],
            model="gpt-4o-mini",
            provider_key="openai",
            connection_slug=None,
        )
        assert resolved.namespace == GatewayEndpointNamespace.STANDARD
        # And the personal route answers nothing.
        with pytest.raises(LLMEndpointNotFoundError):
            await world["service"]._resolve_target(
                scope=world["scope"],
                namespace=GatewayEndpointNamespace.USER,
                name="openai",
            )


async def test_a_person_without_a_key_is_refused_never_the_project_key(world):
    with _run(world, principal_id=uuid4(), bindings=[CALLER_OPENAI]):
        with pytest.raises(LLMPersonalCredentialError) as refused:
            await world["service"]._resolve_target(
                scope=world["scope"],
                namespace=GatewayEndpointNamespace.USER,
                name="openai",
            )
    assert refused.value.code == "personal_account_missing"
    assert refused.value.message == "Connect your OpenAI account to use this agent."


async def test_an_api_key_run_has_no_person(world):
    await _personal_key(world, uuid4())
    with _run(world, kind="api_key", bindings=[CALLER_OPENAI]):
        with pytest.raises(LLMPersonalCredentialError) as refused:
            await world["service"]._resolve_target(
                scope=world["scope"],
                namespace=GatewayEndpointNamespace.USER,
                name="openai",
            )
    assert refused.value.code == "no_person"


async def test_a_channel_turn_uses_the_linked_persons_key(world):
    alice = uuid4()
    secret = await _personal_key(world, alice)
    with _run(
        world, kind="installation", linked_user_id=alice, bindings=[CALLER_OPENAI]
    ):
        target = await world["service"]._resolve_target(
            scope=world["scope"], namespace=GatewayEndpointNamespace.USER, name="openai"
        )
    assert target.resolved_secret.secret.id == secret.id

    with _run(world, kind="installation", bindings=[CALLER_OPENAI]):
        with pytest.raises(LLMPersonalCredentialError) as refused:
            await world["service"]._resolve_target(
                scope=world["scope"],
                namespace=GatewayEndpointNamespace.USER,
                name="openai",
            )
    assert refused.value.code == "channel_user_not_linked"


async def test_another_organization_never_sees_the_key(world):
    alice = uuid4()
    await _personal_key(world, alice)
    other = make_auth_scope(organization_id=uuid4(), project_id=world["project_id"])
    with _run(world, principal_id=alice, bindings=[CALLER_OPENAI]):
        with pytest.raises(LLMPersonalCredentialError) as refused:
            await world["service"]._resolve_target(
                scope=other, namespace=GatewayEndpointNamespace.USER, name="openai"
            )
    assert refused.value.code == "personal_account_missing"


async def test_the_gate_and_the_policy_refuse(world, monkeypatch):
    alice = uuid4()
    await _personal_key(world, alice)
    monkeypatch.setattr(
        policy_module.env.agenta.access, "personal_credentials_enabled", False
    )
    with _run(world, principal_id=alice, bindings=[CALLER_OPENAI]):
        with pytest.raises(LLMPersonalCredentialError) as refused:
            await world["service"]._resolve_target(
                scope=world["scope"],
                namespace=GatewayEndpointNamespace.USER,
                name="openai",
            )
    assert refused.value.code == "personal_credentials_disabled"

    monkeypatch.setattr(
        policy_module.env.agenta.access, "personal_credentials_enabled", True
    )
    monkeypatch.setattr(policy_module, "is_ee", lambda: True)

    async def forbidden(organization_id):
        return False

    monkeypatch.setattr(policy_module, "_organization_allows", forbidden)
    with _run(world, principal_id=alice, bindings=[CALLER_OPENAI]):
        with pytest.raises(LLMPersonalCredentialError) as refused:
            await world["service"]._resolve_target(
                scope=world["scope"],
                namespace=GatewayEndpointNamespace.USER,
                name="openai",
            )
    assert refused.value.code == "personal_credentials_forbidden"
    assert (
        refused.value.message == "Your organization does not allow personal accounts."
    )


async def test_an_unsigned_personal_connection_is_refused_not_shared(world):
    """A run started outside the API (a direct services call) carries no signed
    bindings. When the agent asks for each person's own account, the gateway refuses
    instead of answering the project's key."""
    with _run(world, principal_id=uuid4(), bindings=()):
        with pytest.raises(LLMPersonalCredentialError) as refused:
            await world["service"].resolve_agent_connection(
                scope=world["scope"],
                model="gpt-4o-mini",
                provider_key="openai",
                connection_slug=None,
                connection_binding="caller_account",
            )
    assert refused.value.code == "binding_not_signed"
