"""A `VaultService` whose person-owned rows live in memory.

The project and organization paths stay the real service over the caller's DAO. Only the
person-owner methods (CONTRACT section 4.2) are answered here, with the rules the MCP
sign-in code relies on: a row is addressed by (organization, person, slug), `put` replaces
the data of the row at the same slug and kind and keeps its id, and `delete_sign_ins`
removes the grants and tokens at the slugs for every person and the project.
"""

from typing import Dict, List, Optional, Sequence, Tuple
from uuid import UUID, uuid4

from oss.src.core.secrets.dtos import CreateSecretDTO, SecretOwner, SecretResponseDTO
from oss.src.core.secrets.enums import SecretKind, SecretOwnerKind
from oss.src.core.secrets.services import VaultService

_SIGN_IN_KINDS = (SecretKind.OAUTH_GRANT, SecretKind.MCP_TOKEN)


class PersonRowsVaultService(VaultService):
    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.person_rows: Dict[Tuple[UUID, UUID, str], SecretResponseDTO] = {}
        self.person_calls: List[str] = []

    def _row(self, *, organization_id, user_id, slug) -> Optional[SecretResponseDTO]:
        return self.person_rows.get((organization_id, user_id, slug))

    async def get_personal_secret_by_slug(self, *, organization_id, user_id, slug):
        self.person_calls.append("get_personal_secret_by_slug")
        return self._row(organization_id=organization_id, user_id=user_id, slug=slug)

    async def get_personal_secret_by_id(self, *, organization_id, user_id, secret_id):
        self.person_calls.append("get_personal_secret_by_id")
        return next(
            (
                row
                for (org, user, _), row in self.person_rows.items()
                if org == organization_id and user == user_id and row.id == secret_id
            ),
            None,
        )

    async def put_personal_secret(
        self, *, organization_id, user_id, create_secret_dto: CreateSecretDTO
    ):
        self.person_calls.append("put_personal_secret")
        key = (organization_id, user_id, create_secret_dto.slug)
        existing = self.person_rows.get(key)
        row = SecretResponseDTO(
            id=existing.id if existing is not None else uuid4(),
            slug=create_secret_dto.slug,
            kind=create_secret_dto.secret.kind,
            data=create_secret_dto.secret.data.model_dump(exclude_none=True),
            header=create_secret_dto.header,
            owner=SecretOwner(kind=SecretOwnerKind.USER, id=user_id),
        )
        self.person_rows[key] = row
        return row

    async def delete_personal_secret_by_slug(self, *, organization_id, user_id, slug):
        self.person_calls.append("delete_personal_secret_by_slug")
        return self.person_rows.pop((organization_id, user_id, slug), None) is not None

    async def list_personal_sign_ins(
        self, *, organization_id, user_id, slugs: Sequence[str]
    ):
        self.person_calls.append("list_personal_sign_ins")
        return [
            row
            for (org, user, slug), row in self.person_rows.items()
            if org == organization_id
            and user == user_id
            and slug in slugs
            and row.kind in _SIGN_IN_KINDS
        ]

    async def delete_sign_ins(self, *, organization_id, project_id, slugs):
        self.person_calls.append("delete_sign_ins")
        doomed = [
            key
            for key, row in self.person_rows.items()
            if key[0] == organization_id
            and key[2] in slugs
            and row.kind in _SIGN_IN_KINDS
        ]
        for key in doomed:
            del self.person_rows[key]
        return len(doomed)
