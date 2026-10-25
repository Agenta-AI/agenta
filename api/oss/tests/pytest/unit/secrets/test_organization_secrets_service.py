"""Organization credential management in `VaultService` (M5, Task 5)."""

from uuid import uuid4

import pytest

import oss.src.core.secrets.services as services_module
from oss.src.core.secrets.dtos import CreateSecretDTO, UpdateSecretDTO
from oss.src.core.secrets.enums import SecretAvailability, SecretOwnerKind
from oss.src.core.secrets.limits import NoProjectLimits
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.types import (
    OrganizationSecretKindNotInheritable,
    OrganizationSecretNotServed,
    OrganizationSecretValueTooShort,
    ProjectLimitNotAllowed,
    ProjectNotInOrganization,
)
from oss.tests.pytest.utils.organization_secrets import (
    SENTINEL_KEY,
    InMemorySecretsDAO,
    install_cache_engine,
    org_secret_payload,
)


class _AllowLimits:
    async def allows_selected_projects(self, *, organization_id):
        return True


class _Registrar:
    def __init__(self):
        self.calls = []

    async def register(self, **kwargs):
        self.calls.append(("register", kwargs))

    async def deregister(self, **kwargs):
        self.calls.append(("deregister", kwargs))


@pytest.fixture
def world(monkeypatch):
    engine = install_cache_engine(monkeypatch)
    events = []

    async def record(**kwargs):
        events.append(kwargs)

    monkeypatch.setattr(services_module, "_safe_publish", record)
    organization_id = uuid4()
    sales, marketing = uuid4(), uuid4()
    other = uuid4()
    dao = InMemorySecretsDAO(
        projects={sales: organization_id, marketing: organization_id, other: uuid4()}
    )
    registrar = _Registrar()

    def vault(limits=None):
        return VaultService(
            dao, llm_endpoint_registrar=registrar, project_limits=limits
        )

    return dict(
        engine=engine,
        events=events,
        dao=dao,
        vault=vault,
        registrar=registrar,
        organization_id=organization_id,
        sales=sales,
        marketing=marketing,
        other=other,
    )


def _dto(**kwargs) -> CreateSecretDTO:
    return CreateSecretDTO.model_validate(org_secret_payload(**kwargs))


def _custom_secret() -> CreateSecretDTO:
    return CreateSecretDTO.model_validate(
        {
            "header": {"name": "token"},
            "secret": {
                "kind": "custom_secret",
                "data": {"secret": {"format": "text", "content": "value-123456"}},
            },
        }
    )


async def test_create_provider_key_for_the_organization(world):
    created = await world["vault"]().create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=_dto(slug="openai-company"),
        user_id=uuid4(),
    )
    assert created.owner.kind == SecretOwnerKind.ORGANIZATION
    assert created.owner.id == world["organization_id"]
    assert created.write_only is True
    assert created.availability == SecretAvailability.ALL_PROJECTS
    assert world["registrar"].calls == []  # no endpoint row for an organization row


async def test_derived_slug_and_name_for_an_unnamed_key(world):
    body = org_secret_payload()
    body["header"] = {}
    created = await world["vault"]().create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=CreateSecretDTO.model_validate(body),
        user_id=uuid4(),
    )
    assert created.header.name == "OpenAI (Organization)"
    assert created.slug and len(created.slug.rsplit("-", 1)[-1]) == 12


async def test_refuses_custom_secret_subscription_and_sso_kinds(world):
    vault = world["vault"]()
    for dto in (
        _custom_secret(),
        CreateSecretDTO.model_validate(
            {
                "header": {"name": "ChatGPT"},
                "secret": {
                    "kind": "subscription_provider",
                    "data": {"provider": "chatgpt"},
                },
            }
        ),
        CreateSecretDTO.model_validate(
            {
                "header": {"name": "SSO"},
                "secret": {
                    "kind": "sso_provider",
                    "data": {
                        "provider": {
                            "client_id": "c",
                            "client_secret": SENTINEL_KEY,
                            "issuer_url": "https://idp.example.com",
                            "scopes": ["openid"],
                        }
                    },
                },
            }
        ),
    ):
        with pytest.raises(OrganizationSecretKindNotInheritable):
            await vault.create_organization_secret(
                organization_id=world["organization_id"],
                create_secret_dto=dto,
                user_id=uuid4(),
            )
    assert world["dao"].records == {}


async def test_refuses_a_non_llm_provider_family(world):
    with pytest.raises(OrganizationSecretKindNotInheritable):
        await world["vault"]().create_organization_secret(
            organization_id=world["organization_id"],
            create_secret_dto=_dto(family="composio"),
            user_id=uuid4(),
        )


@pytest.mark.parametrize("family", ["bedrock", "sagemaker"])
async def test_refuses_bedrock_and_sagemaker_on_create_and_update(world, family):
    vault = world["vault"]()
    with pytest.raises(OrganizationSecretNotServed):
        await vault.create_organization_secret(
            organization_id=world["organization_id"],
            create_secret_dto=_dto(kind="custom_provider", family=family),
            user_id=uuid4(),
        )
    served = await vault.create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=_dto(kind="custom_provider", family="azure", slug="azure-co"),
        user_id=uuid4(),
    )
    update = UpdateSecretDTO.model_validate(
        {
            "secret": {
                "kind": "custom_provider",
                "data": {
                    "kind": family,
                    "provider": {
                        "url": "https://llm.example.com/v1",
                        "key": "sk-12345678",
                    },
                    "models": [{"slug": "m"}],
                },
            }
        }
    )
    with pytest.raises(OrganizationSecretNotServed):
        await vault.update_organization_secret(
            organization_id=world["organization_id"],
            secret_id=served.id,
            update_secret_dto=update,
            user_id=uuid4(),
        )


@pytest.mark.parametrize(
    "payload",
    [
        dict(key="m5key12"),
        dict(key="  m5key12  "),
        dict(kind="custom_provider", family="custom", key="m5key12"),
        dict(kind="custom_provider", family="custom", key="   m5key12"),
        dict(
            kind="custom_provider",
            family="custom",
            key=None,
            extras={"api_key": "m5key12"},
        ),
        dict(
            kind="custom_provider",
            family="custom",
            key=None,
            extras={"api_key": " m5key12 "},
        ),
    ],
    ids=[
        "key",
        "padded-key",
        "custom-key",
        "padded-custom-key",
        "extras",
        "padded-extras",
    ],
)
async def test_refuses_a_value_shorter_than_the_echo_scan_minimum(world, payload):
    body = org_secret_payload(**payload)
    if payload.get("key", "x") is None:
        body["secret"]["data"]["provider"].pop("key", None)
    with pytest.raises(OrganizationSecretValueTooShort):
        await world["vault"]().create_organization_secret(
            organization_id=world["organization_id"],
            create_secret_dto=CreateSecretDTO.model_validate(body),
            user_id=uuid4(),
        )
    assert world["dao"].records == {}


async def test_values_are_stored_stripped_and_eight_characters_pass(world):
    vault = world["vault"]()
    created = await vault.create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=_dto(
            kind="custom_provider",
            family="custom",
            key="  m5key123 ",
            extras={"api_key": " m5extra1 "},
        ),
        user_id=uuid4(),
    )
    assert created.data.provider.key == "m5key123"
    assert created.data.provider.extras["api_key"] == "m5extra1"
    keyless_body = org_secret_payload(
        kind="custom_provider", family="custom", slug="keyless"
    )
    keyless_body["secret"]["data"]["provider"].pop("key")
    keyless = await vault.create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=CreateSecretDTO.model_validate(keyless_body),
        user_id=uuid4(),
    )
    assert keyless.data.provider.key is None


async def test_update_refuses_a_short_or_padded_value(world):
    vault = world["vault"]()
    created = await vault.create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=_dto(slug="openai-company"),
        user_id=uuid4(),
    )
    for key in ("m5key12", "   m5key12   "):
        with pytest.raises(OrganizationSecretValueTooShort):
            await vault.update_organization_secret(
                organization_id=world["organization_id"],
                secret_id=created.id,
                update_secret_dto=UpdateSecretDTO.model_validate(
                    {
                        "secret": {
                            "kind": "provider_key",
                            "data": {"kind": "openai", "provider": {"key": key}},
                        }
                    }
                ),
                user_id=uuid4(),
            )


async def test_update_keeps_the_value_when_omitted(world):
    vault = world["vault"]()
    created = await vault.create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=_dto(slug="openai-company"),
        user_id=uuid4(),
    )
    updated = await vault.update_organization_secret(
        organization_id=world["organization_id"],
        secret_id=created.id,
        update_secret_dto=UpdateSecretDTO.model_validate(
            {
                "header": {"name": "Renamed"},
                "secret": {
                    "kind": "provider_key",
                    "data": {"kind": "openai", "provider": {}},
                },
            }
        ),
        user_id=uuid4(),
    )
    assert updated.header.name == "Renamed"
    assert updated.data.provider.key == SENTINEL_KEY


async def test_selected_projects_refused_in_oss(world):
    for limits in (None, NoProjectLimits()):
        with pytest.raises(ProjectLimitNotAllowed):
            await world["vault"](limits).create_organization_secret(
                organization_id=world["organization_id"],
                create_secret_dto=_dto(),
                user_id=uuid4(),
                availability=SecretAvailability.SELECTED_PROJECTS,
                project_ids=[world["sales"]],
            )
    assert world["dao"].records == {}


async def test_all_projects_always_allowed(world):
    vault = world["vault"](NoProjectLimits())
    created = await vault.create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=_dto(slug="a"),
        user_id=uuid4(),
    )
    widened = await vault.set_organization_secret_availability(
        organization_id=world["organization_id"],
        secret_id=created.id,
        availability=SecretAvailability.ALL_PROJECTS,
        project_ids=[],
        user_id=uuid4(),
    )
    assert widened.availability == SecretAvailability.ALL_PROJECTS


async def test_a_foreign_project_limit_is_refused(world):
    with pytest.raises(ProjectNotInOrganization):
        await world["vault"](_AllowLimits()).create_organization_secret(
            organization_id=world["organization_id"],
            create_secret_dto=_dto(),
            user_id=uuid4(),
            availability=SecretAvailability.SELECTED_PROJECTS,
            project_ids=[world["sales"], world["other"]],
        )
    assert world["dao"].records == {}


async def test_invalidation_runs_only_after_the_commit(world):
    vault = world["vault"]()
    for project in (world["sales"], world["marketing"]):
        await vault.list_secrets(project_id=project)
    world["engine"].commands.clear()
    with pytest.raises(OrganizationSecretValueTooShort):
        await vault.create_organization_secret(
            organization_id=world["organization_id"],
            create_secret_dto=_dto(key="short"),
            user_id=uuid4(),
        )
    assert world["engine"].commands == []
    assert "list_organization_project_ids" not in world["dao"].calls

    await vault.create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=_dto(slug="ok"),
        user_id=uuid4(),
    )
    assert world["engine"].commands == ["DEL"]
    assert not any(":effective_secrets:" in k for k in world["engine"].store)


async def test_every_organization_write_publishes_one_event(world):
    vault = world["vault"](_AllowLimits())
    user = uuid4()
    created = await vault.create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=_dto(slug="openai-company", key=SENTINEL_KEY),
        user_id=user,
    )
    await vault.update_organization_secret(
        organization_id=world["organization_id"],
        secret_id=created.id,
        update_secret_dto=UpdateSecretDTO.model_validate({"header": {"name": "x"}}),
        user_id=user,
    )
    await vault.set_organization_secret_availability(
        organization_id=world["organization_id"],
        secret_id=created.id,
        availability=SecretAvailability.SELECTED_PROJECTS,
        project_ids=[world["sales"]],
        user_id=user,
    )
    await vault.delete_organization_secret(
        organization_id=world["organization_id"], secret_id=created.id, user_id=user
    )
    actions = [e["event"].attributes["action"] for e in world["events"]]
    assert actions == ["created", "updated", "availability_changed", "deleted"]
    for event in world["events"]:
        assert event["event"].event_type.value == "organization_secrets.changed"
        assert event["organization_id"] == world["organization_id"]
        attributes = event["event"].attributes
        assert set(attributes) <= {
            "organization_id",
            "secret_id",
            "kind",
            "action",
            "availability",
            "project_count",
            "user_id",
        }
        assert SENTINEL_KEY not in str(attributes)
        assert "openai-company" not in str(attributes)
