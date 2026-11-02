"""Organization credential management in `VaultService` (M5, Task 5)."""

from base64 import urlsafe_b64encode
from datetime import datetime, timedelta, timezone
from json import dumps as json_dumps
from uuid import uuid4

import pytest

import oss.src.core.secrets.services as services_module
from oss.src.core.secrets.dtos import CreateSecretDTO, UpdateSecretDTO
from oss.src.core.secrets.enums import (
    SecretAvailability,
    SecretKind,
    SecretOwnerKind,
)
from oss.src.core.secrets.limits import NoProjectLimits
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.subscription_login import RunnerLoginAttempt
from oss.src.core.secrets.subscription_service import SubscriptionLoginService
from oss.src.core.secrets.types import (
    OrganizationSecretKindNotShareable,
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


async def test_refuses_sso_kind(world):
    vault = world["vault"]()
    dto = CreateSecretDTO.model_validate(
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
    )
    with pytest.raises(OrganizationSecretKindNotShareable):
        await vault.create_organization_secret(
            organization_id=world["organization_id"],
            create_secret_dto=dto,
            user_id=uuid4(),
        )
    assert world["dao"].records == {}


async def test_an_organization_custom_secret_is_created_write_only(world):
    """An organization may hold a custom secret (API only). It is never readable back."""
    created = await world["vault"]().create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=_custom_secret(),
        user_id=uuid4(),
    )
    assert created.kind == SecretKind.CUSTOM_SECRET
    assert created.owner.kind == SecretOwnerKind.ORGANIZATION
    assert created.write_only is True
    assert created.slug


async def test_an_organization_subscription_login_is_created_pending_for_all_projects(
    world,
):
    """An organization may hold a subscription login (M5). It is created without a login,
    named with its owner, available to all projects, and gets no gateway endpoint row."""
    created = await world["vault"]().create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=CreateSecretDTO.model_validate(
            {
                "header": {"description": "shared login"},
                "secret": {
                    "kind": "subscription_provider",
                    "data": {"provider": "chatgpt"},
                },
            }
        ),
        user_id=uuid4(),
    )
    assert created.owner.kind == SecretOwnerKind.ORGANIZATION
    assert created.header.name == "ChatGPT (Organization)"
    # A unique slug made from the name: an owner may hold several logins.
    assert created.slug.startswith("chatgpt-organization-")
    assert created.availability == SecretAvailability.ALL_PROJECTS
    assert created.data.login_state == "pending_login"
    assert world["registrar"].calls == []


async def test_refuses_a_non_llm_provider_family(world):
    with pytest.raises(OrganizationSecretKindNotShareable):
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


@pytest.mark.parametrize("value", [12345678901, ["m5extra-list-value"], {"v": "x"}])
async def test_refuses_a_non_text_credential_extras_value(world, value):
    vault = world["vault"]()
    body = org_secret_payload(
        kind="custom_provider", family="custom", extras={"api_key": value}
    )
    with pytest.raises(OrganizationSecretValueTooShort):
        await vault.create_organization_secret(
            organization_id=world["organization_id"],
            create_secret_dto=CreateSecretDTO.model_validate(body),
            user_id=uuid4(),
        )
    created = await vault.create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=_dto(kind="custom_provider", family="custom", slug="c"),
        user_id=uuid4(),
    )
    with pytest.raises(OrganizationSecretValueTooShort):
        await vault.update_organization_secret(
            organization_id=world["organization_id"],
            secret_id=created.id,
            update_secret_dto=UpdateSecretDTO.model_validate(
                {
                    "secret": {
                        "kind": "custom_provider",
                        "data": {
                            "kind": "custom",
                            "provider": {
                                "url": "https://llm.example.com/v1",
                                "extras": {"api_key": value},
                            },
                            "models": [{"slug": "m"}],
                        },
                    }
                }
            ),
            user_id=uuid4(),
        )


@pytest.mark.parametrize(
    "value",
    [
        'org-key-"abcdefgh"',
        "org-key\\abcdefgh",
        "org-key-<abcdefgh>",
        "org-key-a&bcdefgh",
        "org key abcdefgh",
        "org-key-abcdéfgh",
    ],
    ids=["quote", "backslash", "angle", "ampersand", "space", "non-ascii"],
)
@pytest.mark.parametrize("where", ["key", "extras"])
async def test_refuses_characters_json_encoders_escape(world, value, where):
    from oss.src.core.secrets.types import OrganizationSecretValueNotScannable

    body = (
        org_secret_payload(kind="custom_provider", family="custom", key=value)
        if where == "key"
        else org_secret_payload(
            kind="custom_provider",
            family="custom",
            key=SENTINEL_KEY,
            extras={"api_key": value},
        )
    )
    with pytest.raises(OrganizationSecretValueNotScannable):
        await world["vault"]().create_organization_secret(
            organization_id=world["organization_id"],
            create_secret_dto=CreateSecretDTO.model_validate(body),
            user_id=uuid4(),
        )
    assert world["dao"].records == {}


async def test_a_structured_vertex_document_keeps_its_characters(world):
    import json

    document = json.dumps(
        {
            "type": "service_account",
            "private_key": "-----BEGIN KEY-----\nabc+/=\n-----END KEY-----\n",
        }
    )
    body = org_secret_payload(
        kind="custom_provider",
        family="vertex_ai",
        key=None,
        extras={
            "vertex_ai_credentials": document,
            "vertex_ai_project": "p",
            "vertex_ai_location": "us-central1",
        },
    )
    body["secret"]["data"]["provider"].pop("key", None)
    created = await world["vault"]().create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=CreateSecretDTO.model_validate(body),
        user_id=uuid4(),
    )
    assert created.data.provider.extras["vertex_ai_credentials"] == document


async def test_every_action_carries_kind_availability_and_project_count(world):
    vault = world["vault"](_AllowLimits())
    created = await vault.create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=_dto(slug="audited"),
        user_id=uuid4(),
    )
    await vault.set_organization_secret_availability(
        organization_id=world["organization_id"],
        secret_id=created.id,
        availability=SecretAvailability.SELECTED_PROJECTS,
        project_ids=[world["sales"]],
        user_id=uuid4(),
    )
    await vault.delete_organization_secret(
        organization_id=world["organization_id"], secret_id=created.id
    )
    for event in world["events"]:
        attributes = event["event"].attributes
        assert {"kind", "availability", "project_count", "action", "secret_id"} <= set(
            attributes
        )
        assert attributes["kind"] == "provider_key"
    counts = [e["event"].attributes["project_count"] for e in world["events"]]
    assert counts == [2, 1, 1]  # all projects, the one selected, the one it reached


async def test_the_event_is_published_when_the_cache_delete_fails(world, monkeypatch):
    import oss.src.core.secrets.services as services

    async def broken(entries):
        raise ConnectionError("redis down")

    monkeypatch.setattr(services, "invalidate_cache_entries", broken)
    await world["vault"]().create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=_dto(slug="still-audited"),
        user_id=uuid4(),
    )
    assert [e["event"].attributes["action"] for e in world["events"]] == ["created"]


async def test_a_failed_project_list_logs_and_does_not_raise(
    world, monkeypatch, caplog
):
    async def broken(**kwargs):
        raise RuntimeError("database down")

    monkeypatch.setattr(world["dao"], "list_organization_project_ids", broken)
    with caplog.at_level("WARNING"):
        created = await world["vault"]().create_organization_secret(
            organization_id=world["organization_id"],
            create_secret_dto=_dto(slug="no-list"),
            user_id=uuid4(),
        )
    assert created.slug == "no-list"
    messages = " ".join(r.getMessage() for r in caplog.records)
    assert "cache invalidation failed" in messages
    assert "event not published" in messages


def _codex_access_token(account_id: str) -> str:
    """Three segments with the account in the claim, as a Codex access token has."""

    def segment(payload: dict) -> str:
        return urlsafe_b64encode(json_dumps(payload).encode()).decode().rstrip("=")

    claim = {"https://api.openai.com/auth": {"chatgpt_account_id": account_id}}
    return f"{segment({'alg': 'RS256'})}.{segment(claim)}.c2lnbmF0dXJl"


class _Runner:
    """A runner that starts one device login."""

    async def start_attempt(self, **_kwargs):
        return RunnerLoginAttempt(
            attempt_id="att-1",
            state="pending",
            user_code="ABCD-1234",
            verification_uri="https://auth.example.test/device",
            expires_at=(datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
        )


class _AcceptingTokenClient:
    async def check(self, token):
        return None


async def _organization_login(world, provider: str):
    vault = world["vault"](_AllowLimits())
    created = await vault.create_organization_secret(
        organization_id=world["organization_id"],
        create_secret_dto=CreateSecretDTO.model_validate(
            {
                "header": {},
                "secret": {
                    "kind": "subscription_provider",
                    "data": {"provider": provider},
                },
                "scope": "organization",
            }
        ),
        user_id=uuid4(),
        availability=SecretAvailability.SELECTED_PROJECTS,
        project_ids=[world["sales"]],
    )
    world["events"].clear()
    service = SubscriptionLoginService(
        vault_service=vault,
        runner_client=_Runner(),
        claude_token_client=_AcceptingTokenClient(),
    )
    return service, created


async def test_a_finished_organization_device_login_is_audited_once(world):
    service, created = await _organization_login(world, "chatgpt")
    scope = dict(organization_id=world["organization_id"], secret_id=created.id)

    await service.start_attempt(**scope, user_id=uuid4())
    assert world["events"] == []  # starting a sign-in stores nothing

    await service.report_attempt_outcome(
        **scope,
        attempt_id="att-1",
        state="succeeded",
        login={
            "type": "oauth",
            "access": _codex_access_token("acct-1"),
            "refresh": "refresh-1",
            "expires": 4_102_444_800_000,
            "accountId": "acct-1",
        },
    )
    # The poll that reads the outcome clears the attempt: no second event.
    await service.read_attempt(**scope, attempt_id="att-1", user_id=uuid4())

    assert len(world["events"]) == 1
    attributes = world["events"][0]["event"].attributes
    assert attributes["action"] == "updated"
    assert attributes["project_count"] == 1


async def test_a_failed_or_cancelled_organization_device_login_is_not_audited(world):
    service, created = await _organization_login(world, "chatgpt")
    scope = dict(organization_id=world["organization_id"], secret_id=created.id)

    await service.start_attempt(**scope)
    await service.report_attempt_outcome(
        **scope, attempt_id="att-1", state="failed", error="denied"
    )
    await service.read_attempt(**scope, attempt_id="att-1")

    assert world["events"] == []


async def test_a_stored_organization_token_is_audited_with_its_person(world):
    service, created = await _organization_login(world, "claude")
    person = uuid4()

    await service.set_subscription_token(
        organization_id=world["organization_id"],
        secret_id=created.id,
        token="sk-ant-oat01-" + "a" * 40,
        user_id=person,
    )

    assert len(world["events"]) == 1
    assert world["events"][0]["event"].attributes["user_id"] == str(person)
