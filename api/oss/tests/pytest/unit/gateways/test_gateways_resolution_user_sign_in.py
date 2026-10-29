"""The user branch of the gateway secret resolver: a person's MCP sign-in, read by id.

The relay names the person (the run person) on the reference, and the resolver reads only
that person's row in the run's organization. The model plane never reads a person's row.
"""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from oss.src.core.gateways.policy.dtos import (
    BoundSecretRef,
    GatewayPlane,
    SecretMode,
)
from oss.src.core.gateways.policy.resolution import SecretsResolver
from oss.src.core.gateways.policy.types import SecretNotFoundError
from oss.src.core.secrets.dtos import (
    CustomSecretDTO,
    CustomSecretSettingsDTO,
    SecretOwner,
    SecretResponseDTO,
)
from oss.src.core.secrets.enums import CustomSecretFormat, SecretKind, SecretOwnerKind
from oss.src.core.shared.dtos import Header
from oss.src.utils.context import AuthScope


def _scope() -> AuthScope:
    return AuthScope(organization_id=uuid4(), project_id=uuid4(), user_id=uuid4())


def _token_row(*, user_id, organization_id=None) -> SecretResponseDTO:
    return SecretResponseDTO(
        id=uuid4(),
        slug="mcp-token-0123456789ab",
        kind=SecretKind.MCP_TOKEN,
        data=CustomSecretDTO(
            secret=CustomSecretSettingsDTO(
                format=CustomSecretFormat.TEXT, content="person-token"
            )
        ),
        header=Header(name="token"),
        owner=SecretOwner.for_user(
            organization_id=organization_id or uuid4(), user_id=user_id
        ),
    )


class _Vault:
    """Records every read; answers a person's row only for its owner."""

    def __init__(self, row=None, owner_id=None, organization_id=None):
        self.row = row
        self.owner_id = owner_id
        self.organization_id = organization_id
        self.calls = []

    async def get_personal_secret_by_id(self, *, organization_id, user_id, secret_id):
        self.calls.append(("person", organization_id, user_id, secret_id))
        if (
            self.row is not None
            and secret_id == self.row.id
            and user_id == self.owner_id
            and organization_id == self.organization_id
        ):
            return self.row
        return None

    async def get_secret_by_id(self, secret_id, project_id=None):
        self.calls.append(("project", project_id, secret_id))
        return None


def _user_ref(*, secret_id, user_id) -> BoundSecretRef:
    return BoundSecretRef(
        secret_id=secret_id, owner_kind=SecretOwnerKind.USER, user_id=user_id
    )


def test_a_user_reference_must_name_the_person():
    with pytest.raises(ValidationError):
        BoundSecretRef(secret_id=uuid4(), owner_kind=SecretOwnerKind.USER)


def test_only_a_user_reference_names_a_person():
    with pytest.raises(ValidationError):
        BoundSecretRef(secret_id=uuid4(), user_id=uuid4())


@pytest.mark.asyncio
async def test_the_mcp_plane_reads_the_persons_row_in_the_runs_organization():
    scope, person = _scope(), uuid4()
    row = _token_row(user_id=person, organization_id=scope.organization_id)
    vault = _Vault(row=row, owner_id=person, organization_id=scope.organization_id)
    resolver = SecretsResolver(vault_service=vault, plane=GatewayPlane.MCP)

    resolved = await resolver.resolve(
        scope=scope,
        ref=_user_ref(secret_id=row.id, user_id=person),
        mode=SecretMode.PROJECT_ONLY,
    )

    assert resolved.secret.id == row.id
    assert resolved.owner == SecretOwner.for_user(
        organization_id=scope.organization_id, user_id=person
    )
    # One read, of the person's own row, and no project read.
    assert vault.calls == [("person", scope.organization_id, person, row.id)]


@pytest.mark.asyncio
async def test_another_persons_row_is_not_found():
    scope, owner, other = _scope(), uuid4(), uuid4()
    row = _token_row(user_id=owner)
    vault = _Vault(row=row, owner_id=owner, organization_id=scope.organization_id)
    resolver = SecretsResolver(vault_service=vault, plane=GatewayPlane.MCP)

    with pytest.raises(SecretNotFoundError):
        await resolver.resolve(
            scope=scope,
            ref=_user_ref(secret_id=row.id, user_id=other),
            mode=SecretMode.PROJECT_ONLY,
        )


@pytest.mark.asyncio
async def test_the_model_plane_never_reads_a_persons_row():
    scope, person = _scope(), uuid4()
    row = _token_row(user_id=person)
    vault = _Vault(row=row, owner_id=person, organization_id=scope.organization_id)
    resolver = SecretsResolver(vault_service=vault, plane=GatewayPlane.LLM)

    with pytest.raises(SecretNotFoundError):
        await resolver.resolve(
            scope=scope,
            ref=_user_ref(secret_id=row.id, user_id=person),
            mode=SecretMode.PROJECT_ONLY,
        )
    assert vault.calls == []


@pytest.mark.asyncio
async def test_a_project_reference_is_read_as_on_main():
    scope = _scope()
    vault = _Vault()
    resolver = SecretsResolver(vault_service=vault, plane=GatewayPlane.MCP)
    secret_id = uuid4()

    with pytest.raises(SecretNotFoundError):
        await resolver.resolve(
            scope=scope,
            ref=BoundSecretRef(secret_id=secret_id),
            mode=SecretMode.PROJECT_ONLY,
        )
    assert vault.calls == [("project", scope.project_id, secret_id)]
