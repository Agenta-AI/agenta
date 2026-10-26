"""The read side of organization credentials: explicit scope, no merge (M5)."""

from uuid import uuid4

from oss.src.core.secrets.dtos import (
    CachedEffectiveSecrets,
    SecretResponseDTO,
)
from oss.src.core.secrets.enums import SecretOwnerKind
from oss.src.core.secrets.scopes import (
    available_organization_secrets,
    is_llm_provider_family,
    organization_matches,
    provider_candidates,
)

PROJECT = uuid4()
ORGANIZATION = uuid4()


def _row(*, slug, owner_kind, kind="provider_key", family="openai", owner_id=None):
    owner_id = owner_id or (
        PROJECT if owner_kind == SecretOwnerKind.PROJECT else ORGANIZATION
    )
    if kind == "provider_key":
        data = {"kind": family, "provider": {"key": "sk-0123456789"}}
    elif kind == "custom_provider":
        data = {
            "kind": family,
            "provider": {"url": "https://llm.example.com/v1", "key": "sk-0123456789"},
            "models": [{"slug": "m"}],
        }
    else:
        data = {
            "provider": {
                "client_id": "c",
                "issuer_url": "https://idp.example.com",
                "scopes": ["openid"],
            }
        }
    return SecretResponseDTO.model_validate(
        {
            "id": str(uuid4()),
            "slug": slug,
            "kind": kind,
            "data": data,
            "header": {"name": slug or kind},
            "owner": {"kind": owner_kind.value, "id": str(owner_id)},
        }
    )


def _entry(secrets, organization, organization_id=ORGANIZATION):
    return CachedEffectiveSecrets(
        project_id=PROJECT,
        organization_id=organization_id,
        secrets=secrets,
        organization=organization,
    )


def test_organization_rows_are_listed_apart_from_project_rows():
    own = _row(slug="openai-company", owner_kind=SecretOwnerKind.PROJECT)
    company = _row(slug="openai-company", owner_kind=SecretOwnerKind.ORGANIZATION)
    entry = _entry([own], [company])
    # The same slug in both scopes: two connections, neither hides the other.
    assert [
        s.id
        for s in available_organization_secrets(
            entry=entry, organization_id=ORGANIZATION
        )
    ] == [company.id]
    assert [s.id for s in entry.secrets] == [own.id]


def test_a_mismatched_organization_gets_no_organization_row():
    company = _row(slug="openai-company", owner_kind=SecretOwnerKind.ORGANIZATION)
    entry = _entry([], [company])
    assert not organization_matches(entry=entry, organization_id=uuid4())
    assert available_organization_secrets(entry=entry, organization_id=uuid4()) == []
    # An entry of an unknown project (no organization) answers none either.
    unknown = _entry([], [company], organization_id=None)
    assert (
        available_organization_secrets(entry=unknown, organization_id=ORGANIZATION)
        == []
    )


def test_sso_rows_are_never_available():
    sso = _row(slug=None, owner_kind=SecretOwnerKind.ORGANIZATION, kind="sso_provider")
    company = _row(slug="openai-company", owner_kind=SecretOwnerKind.ORGANIZATION)
    assert [
        s.id
        for s in available_organization_secrets(
            entry=_entry([], [sso, company]), organization_id=ORGANIZATION
        )
    ] == [company.id]


def test_provider_candidates_keep_the_tie_rule():
    project_key = _row(slug="p", owner_kind=SecretOwnerKind.PROJECT)
    project_custom = _row(
        slug="pc",
        owner_kind=SecretOwnerKind.PROJECT,
        kind="custom_provider",
        family="openai",
    )
    assert provider_candidates(
        secrets=[project_custom, project_key], provider_key="openai"
    ) == [project_key, project_custom]
    assert provider_candidates(secrets=[project_key], provider_key="anthropic") == []


def test_is_llm_provider_family():
    class _Data:
        def __init__(self, kind):
            self.kind = kind

    assert is_llm_provider_family(_Data("openai"))
    assert is_llm_provider_family(_Data("mock"))
    assert not is_llm_provider_family(_Data("composio"))
    assert not is_llm_provider_family(_Data(None))
