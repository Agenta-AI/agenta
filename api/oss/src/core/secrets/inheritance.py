"""The read side of organization credentials: pure functions, no I/O (M5).

A project's effective credential set is its own rows, then the inheritable organization
rows available to it whose slug no project row uses. Inheritance uses the organization
the project row names (`CachedEffectiveSecrets.organization_id`); a request whose
organization differs inherits nothing. The write-side rule that keeps a project row and an
organization row with one slug of the same kind is enforced in SQL, not here.
"""

from typing import Any, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from oss.src.core.secrets.dtos import CachedEffectiveSecrets, SecretResponseDTO
from oss.src.core.secrets.enums import (
    INHERITABLE_KINDS,
    LLMStandardProviderKind,
    SecretKind,
)


class InheritedSecret(BaseModel):
    """What a project member sees about an inherited row (in process)."""

    model_config = ConfigDict(hide_input_in_errors=True)

    secret: SecretResponseDTO
    # The project row with the same slug, when one exists.
    overridden_by_secret_id: Optional[UUID] = None


def inherits(*, entry: CachedEffectiveSecrets, organization_id: Optional[UUID]) -> bool:
    """Whether the request's organization may inherit through this project's entry."""
    return (
        entry.organization_id is not None
        and organization_id is not None
        and entry.organization_id == organization_id
    )


def effective_secrets(
    *, entry: CachedEffectiveSecrets, organization_id: Optional[UUID]
) -> List[SecretResponseDTO]:
    """Project rows, then inherited rows whose slug no project row uses."""
    if not inherits(entry=entry, organization_id=organization_id):
        return list(entry.secrets)
    used = {secret.slug for secret in entry.secrets if secret.slug}
    return list(entry.secrets) + [
        secret
        for secret in entry.inherited
        if secret.kind in INHERITABLE_KINDS and secret.slug not in used
    ]


def inherited_secrets(
    *, entry: CachedEffectiveSecrets, organization_id: Optional[UUID]
) -> List[InheritedSecret]:
    """Every inherited row, with the project row that overrides it."""
    if not inherits(entry=entry, organization_id=organization_id):
        return []
    by_slug = {secret.slug: secret.id for secret in entry.secrets if secret.slug}
    return [
        InheritedSecret(
            secret=secret,
            overridden_by_secret_id=by_slug.get(secret.slug) if secret.slug else None,
        )
        for secret in entry.inherited
        if secret.kind in INHERITABLE_KINDS
    ]


def provider_candidates(
    *, secrets: List[SecretResponseDTO], provider_key: str
) -> List[SecretResponseDTO]:
    """Today's tie rule inside one group: `provider_key` rows of the provider first, then
    `custom_provider` rows of that provider kind, each in stored order."""

    def _kind(secret) -> Optional[str]:
        kind = getattr(secret.data, "kind", None)
        return None if kind is None else str(getattr(kind, "value", kind))

    keys = [
        s
        for s in secrets
        if s.kind == SecretKind.PROVIDER_KEY and _kind(s) == provider_key
    ]
    customs = [
        s
        for s in secrets
        if s.kind == SecretKind.CUSTOM_PROVIDER and _kind(s) == provider_key
    ]
    return keys + customs


def is_llm_provider_family(data: Any) -> bool:
    """The create-time rule for an organization `provider_key`: an LLM provider family."""
    kind = getattr(data, "kind", None)
    value = getattr(kind, "value", kind)
    try:
        LLMStandardProviderKind(value)
    except ValueError:
        return False
    return True
