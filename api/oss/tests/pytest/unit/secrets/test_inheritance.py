"""The read-side merge of organization credentials (M5, Task 4)."""

from uuid import uuid4

from oss.src.core.secrets.dtos import (
    CachedEffectiveSecrets,
    SecretResponseDTO,
)
from oss.src.core.secrets.enums import SecretOwnerKind
from oss.src.core.secrets.inheritance import (
    effective_secrets,
    inherited_secrets,
    is_llm_provider_family,
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


def _entry(secrets, inherited, organization_id=ORGANIZATION):
    return CachedEffectiveSecrets(
        project_id=PROJECT,
        organization_id=organization_id,
        secrets=secrets,
        inherited=inherited,
    )


def test_project_rows_come_first_and_shadow_inherited_slugs():
    own = _row(slug="openai-company", owner_kind=SecretOwnerKind.PROJECT)
    shadowed = _row(slug="openai-company", owner_kind=SecretOwnerKind.ORGANIZATION)
    other = _row(
        slug="anthropic-company",
        owner_kind=SecretOwnerKind.ORGANIZATION,
        family="anthropic",
    )
    result = effective_secrets(
        entry=_entry([own], [shadowed, other]), organization_id=ORGANIZATION
    )
    assert [s.id for s in result] == [own.id, other.id]


def test_inherited_rows_without_a_project_row_are_added():
    inherited = _row(slug="openai-company", owner_kind=SecretOwnerKind.ORGANIZATION)
    result = effective_secrets(
        entry=_entry([], [inherited]), organization_id=ORGANIZATION
    )
    assert [s.id for s in result] == [inherited.id]
    assert result[0].write_only is True


def test_mismatched_organization_inherits_nothing():
    own = _row(slug="mine", owner_kind=SecretOwnerKind.PROJECT)
    inherited = _row(slug="openai-company", owner_kind=SecretOwnerKind.ORGANIZATION)
    entry = _entry([own], [inherited])
    assert [s.id for s in effective_secrets(entry=entry, organization_id=uuid4())] == [
        own.id
    ]
    assert inherited_secrets(entry=entry, organization_id=uuid4()) == []
    # An entry of an unknown project (no organization) inherits nothing either.
    unknown = _entry([], [inherited], organization_id=None)
    assert effective_secrets(entry=unknown, organization_id=ORGANIZATION) == []


def test_sso_and_non_inheritable_kinds_stay_out():
    sso = _row(slug=None, owner_kind=SecretOwnerKind.ORGANIZATION, kind="sso_provider")
    inherited = _row(slug="openai-company", owner_kind=SecretOwnerKind.ORGANIZATION)
    entry = _entry([], [sso, inherited])
    assert [
        s.id for s in effective_secrets(entry=entry, organization_id=ORGANIZATION)
    ] == [inherited.id]
    assert [
        i.secret.id
        for i in inherited_secrets(entry=entry, organization_id=ORGANIZATION)
    ] == [inherited.id]


def test_default_prefers_project_candidates():
    project_key = _row(slug="p", owner_kind=SecretOwnerKind.PROJECT)
    project_custom = _row(
        slug="pc",
        owner_kind=SecretOwnerKind.PROJECT,
        kind="custom_provider",
        family="openai",
    )
    company = _row(slug="c", owner_kind=SecretOwnerKind.ORGANIZATION)
    assert provider_candidates(
        secrets=[project_custom, project_key], provider_key="openai"
    ) == [project_key, project_custom]
    assert provider_candidates(secrets=[company], provider_key="openai") == [company]
    assert provider_candidates(secrets=[company], provider_key="anthropic") == []


def test_inherited_projection_marks_the_override():
    own = _row(slug="openai-company", owner_kind=SecretOwnerKind.PROJECT)
    shadowed = _row(slug="openai-company", owner_kind=SecretOwnerKind.ORGANIZATION)
    free = _row(slug="other", owner_kind=SecretOwnerKind.ORGANIZATION)
    result = inherited_secrets(
        entry=_entry([own], [shadowed, free]), organization_id=ORGANIZATION
    )
    assert [(i.secret.id, i.overridden_by_secret_id) for i in result] == [
        (shadowed.id, own.id),
        (free.id, None),
    ]


def test_is_llm_provider_family():
    class _Data:
        def __init__(self, kind):
            self.kind = kind

    assert is_llm_provider_family(_Data("openai"))
    assert is_llm_provider_family(_Data("mock"))
    assert not is_llm_provider_family(_Data("composio"))
    assert not is_llm_provider_family(_Data(None))
