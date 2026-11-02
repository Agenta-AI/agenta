"""The read side of organization credentials: pure functions, no I/O (M5).

An agent names the connection it uses by scope and slug. A project-scoped name (or no name)
reads the project's own rows only. An organization-scoped name reads only the shareable
organization rows available to the project, from the organization the project row names
(`CachedEffectiveSecrets.organization_id`). A request whose organization differs reads no
organization row. A project row and an organization row with the same slug never stand in
for each other.
"""

from typing import Any, List, Optional
from uuid import UUID

from oss.src.core.secrets.dtos import CachedEffectiveSecrets, SecretResponseDTO
from oss.src.core.secrets.enums import (
    ORGANIZATION_SECRET_KINDS,
    LLMStandardProviderKind,
)


def organization_matches(
    *, entry: CachedEffectiveSecrets, organization_id: Optional[UUID]
) -> bool:
    """Whether the request's organization is the one the project belongs to."""
    return (
        entry.organization_id is not None
        and organization_id is not None
        and entry.organization_id == organization_id
    )


def available_organization_secrets(
    *, entry: CachedEffectiveSecrets, organization_id: Optional[UUID]
) -> List[SecretResponseDTO]:
    """The organization rows an agent of this project may name, or none."""
    if not organization_matches(entry=entry, organization_id=organization_id):
        return []
    return [
        secret
        for secret in entry.organization
        if secret.kind in ORGANIZATION_SECRET_KINDS
    ]


def is_llm_provider_family(data: Any) -> bool:
    """The create-time rule for an organization `provider_key`: an LLM provider family."""
    kind = getattr(data, "kind", None)
    value = getattr(kind, "value", kind)
    try:
        LLMStandardProviderKind(value)
    except ValueError:
        return False
    return True
