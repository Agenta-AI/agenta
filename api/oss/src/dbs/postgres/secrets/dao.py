"""Postgres storage of the vault, addressed by owner (M5).

Every method takes a `SecretOwner` and maps its kind to the typed column. Project and
organization rows live in two slug spaces (`uq_secrets_project_id_slug`,
`uq_secrets_organization_id_slug`).

Two rules hold for every write here:

- Errors carry no values. A secrets write binds the plaintext JSON as a parameter of
  `pgp_sym_encrypt`, so a driver error (and its traceback) quotes the credential. Every
  `DBAPIError` becomes a domain error raised `from None`.
- The organization operations address shareable organization rows only
  (`kind IN ORGANIZATION_SECRET_KINDS AND project_id IS NULL`), so an SSO row is never
  listed, read, changed or deleted through them.

A project row and an organization row with the same slug are two separate connections. An
agent names the one it uses by scope and slug, so no write checks one against the other.
"""

from types import SimpleNamespace
from typing import Awaitable, Callable, List, Optional, Sequence, TypeVar
from uuid import UUID

import uuid_utils.compat as uuid_compat
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from oss.src.core.secrets.context import get_data_encryption_key
from oss.src.core.secrets.dtos import (
    CachedEffectiveSecrets,
    OrganizationSecretDeleted,
    CreateSecretDTO,
    SecretOwner,
    SecretResponseDTO,
    UpdateSecretDTO,
)
from oss.src.core.secrets.enums import (
    ORGANIZATION_SECRET_KINDS,
    SecretAvailability,
    SecretKind,
    SecretOwnerKind,
)
from oss.src.core.secrets.interfaces import SecretsDAOInterface
from oss.src.core.secrets.managed import SecretManagementDTO
from oss.src.core.secrets.types import (
    ProjectNotInOrganization,
    SecretSlugConflict,
    SecretStorageError,
    SubscriptionProviderConflict,
)
from oss.src.dbs.postgres.secrets.dbes import SecretsDBE
from oss.src.dbs.postgres.secrets.mappings import (
    map_create_to_payload,
    map_secrets_dbe_to_dto,
    map_secrets_dto_to_dbe,
    map_secrets_dto_to_dbe_update,
)
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

_Result = TypeVar("_Result")

# Postgres enum labels are the member NAMES.
_ORGANIZATION_KIND_LABELS = ", ".join(
    f"'{kind.name}'" for kind in sorted(ORGANIZATION_SECRET_KINDS)
)

_COLUMNS = (
    "s.id, s.slug, s.kind::text AS kind, pgp_sym_decrypt(s.data, CAST(:key AS TEXT)) AS data, "
    "s.project_id, s.organization_id, s.name, s.description, s.created_at, "
    "s.updated_at, s.availability"
)

# ONE statement: the project row's organization, the project's rows, and the shareable
# organization rows available to the project. An unknown project returns no row.
_LOAD_EFFECTIVE_SQL = f"""
SELECT p.organization_id AS project_organization_id, e.*
FROM projects p
LEFT JOIN LATERAL (
    SELECT {_COLUMNS}, false AS from_organization FROM secrets s
    WHERE s.project_id = p.id AND s.kind IS NOT NULL
    UNION ALL
    SELECT {_COLUMNS}, true AS from_organization FROM secrets s
    WHERE s.project_id IS NULL AND s.organization_id = p.organization_id
      AND s.kind IN ({_ORGANIZATION_KIND_LABELS})
      AND (s.availability = 'all_projects' OR EXISTS (SELECT 1 FROM secret_projects sp
           WHERE sp.secret_id = s.id AND sp.project_id = p.id))
) e ON true
WHERE p.id = CAST(:project_id AS UUID)
ORDER BY e.from_organization, e.created_at, e.id
"""

_INSERT_ORGANIZATION_SECRET_SQL = f"""
INSERT INTO secrets AS s (id, slug, kind, data, organization_id, name, description,
                          availability, created_at, created_by_id)
VALUES (CAST(:id AS UUID), CAST(:slug AS VARCHAR), CAST(:kind AS secretkind_enum), pgp_sym_encrypt(CAST(:payload AS TEXT), CAST(:key AS TEXT)),
        CAST(:organization_id AS UUID), CAST(:name AS VARCHAR), CAST(:description AS VARCHAR), CAST(:availability AS VARCHAR), now(), CAST(:user_id AS UUID))
RETURNING {_COLUMNS}
"""

# Only projects of the organization are inserted; the caller compares the count.
_INSERT_SECRET_PROJECTS_SQL = """
INSERT INTO secret_projects (secret_id, project_id, created_at, created_by_id)
SELECT CAST(:secret_id AS UUID), p.id, now(), CAST(:user_id AS UUID) FROM projects p
WHERE p.id = ANY(CAST(:project_ids AS uuid[])) AND p.organization_id = CAST(:organization_id AS UUID)
ON CONFLICT DO NOTHING
"""

_DELETE_SECRET_PROJECTS_SQL = (
    "DELETE FROM secret_projects WHERE secret_id = CAST(:secret_id AS UUID)"
)

_ORGANIZATION_ROW_FILTER = (
    f"s.organization_id = CAST(:organization_id AS UUID) AND s.project_id IS NULL "
    f"AND s.kind IN ({_ORGANIZATION_KIND_LABELS})"
)

_SELECTED_PROJECT_IDS = (
    "(SELECT coalesce(array_agg(sp.project_id ORDER BY sp.project_id), '{}') "
    "FROM secret_projects sp WHERE sp.secret_id = s.id) AS selected_project_ids"
)

_LIST_ORGANIZATION_SECRETS_SQL = f"""
SELECT {_COLUMNS}, {_SELECTED_PROJECT_IDS} FROM secrets s
WHERE {_ORGANIZATION_ROW_FILTER}
ORDER BY s.created_at, s.id
"""

_FETCH_ORGANIZATION_SECRET_SQL = f"""
SELECT {_COLUMNS}, {_SELECTED_PROJECT_IDS} FROM secrets s
WHERE s.id = CAST(:secret_id AS UUID) AND {_ORGANIZATION_ROW_FILTER}
"""

_LOCK_ORGANIZATION_SECRET_SQL = f"""
SELECT {_COLUMNS}, {_SELECTED_PROJECT_IDS} FROM secrets s
WHERE s.id = CAST(:secret_id AS UUID) AND {_ORGANIZATION_ROW_FILTER}
FOR UPDATE OF s
"""

_UPDATE_ORGANIZATION_SECRET_SQL = f"""
UPDATE secrets AS s SET name = CAST(:name AS VARCHAR), description = CAST(:description AS VARCHAR),
    kind = CAST(:kind AS secretkind_enum), data = pgp_sym_encrypt(CAST(:payload AS TEXT), CAST(:key AS TEXT)),
    updated_at = now(), updated_by_id = CAST(:user_id AS UUID)
WHERE s.id = CAST(:secret_id AS UUID) AND {_ORGANIZATION_ROW_FILTER}
RETURNING {_COLUMNS}
"""

_SET_AVAILABILITY_SQL = f"""
UPDATE secrets AS s SET availability = CAST(:availability AS VARCHAR), updated_at = now(),
    updated_by_id = CAST(:user_id AS UUID)
WHERE s.id = CAST(:secret_id AS UUID) AND {_ORGANIZATION_ROW_FILTER}
RETURNING {_COLUMNS}
"""

_DELETE_ORGANIZATION_SECRET_SQL = f"""
DELETE FROM secrets AS s WHERE s.id = CAST(:secret_id AS UUID) AND {_ORGANIZATION_ROW_FILTER}
RETURNING s.id, s.slug, s.kind::text AS kind, s.availability,
    (SELECT count(*) FROM secret_projects sp WHERE sp.secret_id = s.id) AS selected_count
"""

# The default project first: an organization event rides on it.
_LIST_ORGANIZATION_PROJECT_IDS_SQL = (
    "SELECT id FROM projects WHERE organization_id = CAST(:organization_id AS UUID) "
    "ORDER BY is_default DESC, created_at, id"
)


def owner_columns(owner: SecretOwner) -> dict:
    """The typed column an owner maps to. A user owner is M7."""
    if owner.kind == SecretOwnerKind.PROJECT:
        return {"project_id": owner.id}
    if owner.kind == SecretOwnerKind.ORGANIZATION:
        return {"organization_id": owner.id}
    raise ValueError("User-owned secrets are not stored in this release.")


def _owner_filter(owner: SecretOwner) -> list:
    columns = owner_columns(owner)
    if "project_id" in columns:
        return [SecretsDBE.project_id == owner.id]
    return [SecretsDBE.organization_id == owner.id, SecretsDBE.project_id.is_(None)]


def _secret_kind_of(label: str) -> SecretKind:
    return SecretKind[label]


def _row(mapping) -> SimpleNamespace:
    return SimpleNamespace(**dict(mapping))


def _dto(mapping, *, with_selected: bool = False) -> SecretResponseDTO:
    row = _row(mapping)
    selected = None
    if with_selected and row.availability == SecretAvailability.SELECTED_PROJECTS.value:
        selected = list(getattr(row, "selected_project_ids", None) or [])
    return map_secrets_dbe_to_dto(secrets_dbe=row, selected_project_ids=selected)


def _conflict_from(error: DBAPIError, *, create_secret_dto=None) -> Exception:
    """The domain error for a failed secrets write, never the driver error."""
    message = str(getattr(error, "orig", "") or "")
    if "uq_secrets_project_id_slug" in message or "uq_secrets_organization_id_slug" in (
        message
    ):
        if (
            create_secret_dto is not None
            and create_secret_dto.secret.kind == SecretKind.SUBSCRIPTION_PROVIDER
        ):
            provider = create_secret_dto.secret.data.provider
            return SubscriptionProviderConflict(
                provider=getattr(provider, "value", provider)
            )
        # Every other kind gets the generic conflict, so a caller writing under a slug it
        # derives (rather than one the user typed) can read the winner and update instead
        # of crashing on a raw driver error.
        slug = create_secret_dto.slug if create_secret_dto is not None else ""
        return SecretSlugConflict(slug=slug or "")
    return SecretStorageError()


class SecretsDAO(SecretsDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    # -- transactions --------------------------------------------------------------

    async def _in_transaction(
        self,
        work: Callable[[AsyncConnection], Awaitable[_Result]],
        *,
        create_secret_dto: Optional[CreateSecretDTO] = None,
    ) -> _Result:
        """Run `work` in one transaction. A driver error becomes a domain error raised
        `from None`; a domain error raised by `work` rolls it back and passes through."""
        try:
            async with self.engine.transaction() as connection:
                return await work(connection)
        except DBAPIError as error:
            raise _conflict_from(error, create_secret_dto=create_secret_dto) from None

    @staticmethod
    def _key() -> str:
        key = get_data_encryption_key()
        if key is None:
            raise ValueError(
                "Data encryption key must be set in the context before using PGPString."
            )
        return key

    # -- owner-based CRUD ----------------------------------------------------------

    async def create(
        self,
        *,
        owner: SecretOwner,
        create_secret_dto: CreateSecretDTO,
        management: Optional[SecretManagementDTO] = None,
    ) -> SecretResponseDTO:
        columns = owner_columns(owner)

        secrets_dbe = map_secrets_dto_to_dbe(
            project_id=columns.get("project_id"),
            organization_id=columns.get("organization_id"),
            secret_dto=create_secret_dto,
            management=management,
        )
        try:
            async with self.engine.session() as session:
                session.add(secrets_dbe)
                await session.commit()
        except DBAPIError as error:
            raise _conflict_from(error, create_secret_dto=create_secret_dto) from None

        return map_secrets_dbe_to_dto(secrets_dbe=secrets_dbe)

    async def get_by_id(
        self,
        *,
        owner: SecretOwner,
        secret_id: UUID,
    ) -> Optional[SecretResponseDTO]:
        async with self.engine.session() as session:
            stmt = select(SecretsDBE).where(
                SecretsDBE.id == secret_id, *_owner_filter(owner)
            )
            result = await session.execute(stmt)  # type: ignore
            secrets_dbe = result.scalar()

            if secrets_dbe is None:
                return None

            return map_secrets_dbe_to_dto(secrets_dbe=secrets_dbe)

    async def get_by_slug(
        self,
        *,
        owner: SecretOwner,
        secret_slug: str,
    ) -> Optional[SecretResponseDTO]:
        async with self.engine.session() as session:
            stmt = select(SecretsDBE).where(
                SecretsDBE.slug == secret_slug, *_owner_filter(owner)
            )
            result = await session.execute(stmt)  # type: ignore
            secrets_dbe = result.scalar()

            if secrets_dbe is None:
                return None

            return map_secrets_dbe_to_dto(secrets_dbe=secrets_dbe)

    async def list(self, *, owner: SecretOwner) -> List[SecretResponseDTO]:
        async with self.engine.session() as session:
            stmt = select(SecretsDBE).where(*_owner_filter(owner))

            results = await session.execute(stmt)  # type: ignore
            secrets_dbes = results.scalars().all()
            return [
                map_secrets_dbe_to_dto(secrets_dbe=secret_dbe)
                for secret_dbe in secrets_dbes
            ]

    async def update(
        self,
        *,
        owner: SecretOwner,
        secret_id: UUID,
        update_secret_dto: UpdateSecretDTO,
        user_id: Optional[UUID] = None,
        resolve_update: Optional[
            Callable[[SecretResponseDTO, UpdateSecretDTO], Optional[UpdateSecretDTO]]
        ] = None,
    ) -> Optional[SecretResponseDTO]:
        try:
            async with self.engine.session() as session:
                return await self._update_in(
                    session,
                    owner=owner,
                    secret_id=secret_id,
                    update_secret_dto=update_secret_dto,
                    user_id=user_id,
                    resolve_update=resolve_update,
                )
        except DBAPIError as error:
            raise _conflict_from(error) from None

    async def _update_in(
        self,
        session: AsyncSession,
        *,
        owner: SecretOwner,
        secret_id: UUID,
        update_secret_dto: UpdateSecretDTO,
        user_id: Optional[UUID],
        resolve_update,
    ) -> Optional[SecretResponseDTO]:
        # FOR UPDATE lets the domain resolver apply immutable policy and carry-over
        # against the latest committed row before this transaction persists the update.
        stmt = (
            select(SecretsDBE)
            .where(SecretsDBE.id == secret_id, *_owner_filter(owner))
            .with_for_update()
        )
        result = await session.execute(stmt)  # type: ignore
        secrets_dbe = result.scalar()

        if secrets_dbe is None:
            return None

        # Every decision that reads stored state runs HERE, against the locked row.
        # A caller that read the row before this transaction may be holding a snapshot
        # another writer has already replaced; the keep-on-omit carry-over in particular
        # would then write a rotated credential back to its old value.
        if resolve_update is not None:
            resolved = resolve_update(
                map_secrets_dbe_to_dto(secrets_dbe=secrets_dbe),
                update_secret_dto,
            )
            # None means the resolver found nothing to change. Returning here leaves the
            # lifecycle columns alone and rolls the transaction back, so a poll that learns
            # nothing costs a read and no write.
            if resolved is None:
                return map_secrets_dbe_to_dto(secrets_dbe=secrets_dbe)
            update_secret_dto = resolved

        map_secrets_dto_to_dbe_update(
            secrets_dbe=secrets_dbe,
            update_secret_dto=update_secret_dto,
            user_id=user_id,
        )

        await session.commit()
        await session.refresh(secrets_dbe)

        return map_secrets_dbe_to_dto(secrets_dbe=secrets_dbe)

    async def delete(
        self,
        *,
        owner: SecretOwner,
        secret_id: UUID,
        authorize_delete: Optional[Callable[[SecretResponseDTO], None]] = None,
    ) -> None:
        try:
            async with self.engine.session() as session:
                stmt = (
                    select(SecretsDBE)
                    .where(SecretsDBE.id == secret_id, *_owner_filter(owner))
                    .with_for_update()
                )
                result = await session.execute(stmt)  # type: ignore
                vault_secret_dbe = result.scalar()
                if vault_secret_dbe is None:
                    return

                if authorize_delete is not None:
                    authorize_delete(
                        map_secrets_dbe_to_dto(secrets_dbe=vault_secret_dbe)
                    )

                await session.delete(vault_secret_dbe)
                await session.commit()
        except DBAPIError as error:
            raise _conflict_from(error) from None

    # -- the effective set (one statement) -----------------------------------------

    async def load_effective(self, *, project_id: UUID) -> CachedEffectiveSecrets:
        async with self.engine.session() as session:
            result = await session.execute(
                text(_LOAD_EFFECTIVE_SQL),
                {"project_id": project_id, "key": self._key()},
            )
            rows = result.mappings().all()

        if not rows:
            return CachedEffectiveSecrets(project_id=project_id)

        secrets: List[SecretResponseDTO] = []
        organization: List[SecretResponseDTO] = []
        for row in rows:
            if row["id"] is None:  # a project with no rows: the LEFT JOIN's empty match
                continue
            (organization if row["from_organization"] else secrets).append(_dto(row))

        return CachedEffectiveSecrets(
            project_id=project_id,
            organization_id=rows[0]["project_organization_id"],
            secrets=secrets,
            organization=organization,
        )

    # -- organization credentials (shareable kinds only) -----------------------------

    async def list_organization_secrets(
        self, *, organization_id: UUID
    ) -> List[SecretResponseDTO]:
        async with self.engine.session() as session:
            result = await session.execute(
                text(_LIST_ORGANIZATION_SECRETS_SQL),
                {"organization_id": organization_id, "key": self._key()},
            )
            return [_dto(row, with_selected=True) for row in result.mappings().all()]

    async def fetch_organization_secret(
        self, *, organization_id: UUID, secret_id: UUID
    ) -> Optional[SecretResponseDTO]:
        async with self.engine.session() as session:
            result = await session.execute(
                text(_FETCH_ORGANIZATION_SECRET_SQL),
                {
                    "organization_id": organization_id,
                    "secret_id": secret_id,
                    "key": self._key(),
                },
            )
            row = result.mappings().first()
            return _dto(row, with_selected=True) if row is not None else None

    async def _write_selected_projects(
        self,
        connection: AsyncConnection,
        *,
        organization_id: UUID,
        secret_id: UUID,
        project_ids: Sequence[UUID],
        user_id: Optional[UUID],
    ) -> None:
        wanted = list(dict.fromkeys(project_ids))
        if not wanted:
            return
        result = await connection.execute(
            text(_INSERT_SECRET_PROJECTS_SQL),
            {
                "secret_id": secret_id,
                "project_ids": wanted,
                "organization_id": organization_id,
                "user_id": user_id,
            },
        )
        if result.rowcount != len(wanted):
            raise ProjectNotInOrganization(project_ids=wanted)

    async def create_organization_secret(
        self,
        *,
        organization_id: UUID,
        create_secret_dto: CreateSecretDTO,
        availability: SecretAvailability,
        project_ids: Sequence[UUID],
        user_id: Optional[UUID],
    ) -> SecretResponseDTO:
        kind = create_secret_dto.secret.kind
        if kind not in ORGANIZATION_SECRET_KINDS:
            raise ValueError("Only shareable kinds are organization credentials.")
        selected = (
            list(dict.fromkeys(project_ids))
            if availability == SecretAvailability.SELECTED_PROJECTS
            else []
        )

        async def work(connection: AsyncConnection):
            result = await connection.execute(
                text(_INSERT_ORGANIZATION_SECRET_SQL),
                {
                    "id": uuid_compat.uuid7(),
                    "slug": create_secret_dto.slug,
                    "kind": kind.name,
                    "payload": map_create_to_payload(secret_dto=create_secret_dto),
                    "key": self._key(),
                    "organization_id": organization_id,
                    "name": (
                        create_secret_dto.header.name
                        if create_secret_dto.header
                        else None
                    ),
                    "description": (
                        create_secret_dto.header.description
                        if create_secret_dto.header
                        else None
                    ),
                    "availability": availability.value,
                    "user_id": user_id,
                },
            )
            row = _row(result.mappings().first())
            await self._write_selected_projects(
                connection,
                organization_id=organization_id,
                secret_id=row.id,
                project_ids=selected,
                user_id=user_id,
            )
            row.selected_project_ids = sorted(selected) if selected else []
            return _dto(vars(row), with_selected=True)

        return await self._in_transaction(work, create_secret_dto=create_secret_dto)

    async def update_organization_secret(
        self,
        *,
        organization_id: UUID,
        secret_id: UUID,
        update_secret_dto: UpdateSecretDTO,
        user_id: Optional[UUID],
        resolve_update: Callable[
            [SecretResponseDTO, UpdateSecretDTO], Optional[UpdateSecretDTO]
        ],
    ) -> Optional[SecretResponseDTO]:
        key = self._key()

        async def work(connection: AsyncConnection):
            locked = await connection.execute(
                text(_LOCK_ORGANIZATION_SECRET_SQL),
                {
                    "organization_id": organization_id,
                    "secret_id": secret_id,
                    "key": key,
                },
            )
            stored_row = locked.mappings().first()
            if stored_row is None:
                return None
            stored = _dto(stored_row, with_selected=True)

            resolved = resolve_update(stored, update_secret_dto)
            if resolved is None:
                return stored
            if resolved.secret is not None and resolved.secret.kind not in (
                ORGANIZATION_SECRET_KINDS
            ):
                raise ValueError("Only shareable kinds are organization credentials.")

            kind = resolved.secret.kind if resolved.secret else stored.kind
            data = resolved.secret.data if resolved.secret else stored.data

            header = resolved.header
            payload_dto = CreateSecretDTO.model_validate(
                {
                    "header": {
                        "name": header.name
                        if header and header.name
                        else stored.header.name,
                        "description": (
                            header.description
                            if header and header.description is not None
                            else stored.header.description
                        ),
                    },
                    "secret": {
                        "kind": kind.value,
                        "data": data.model_dump(mode="json", exclude_none=True),
                    },
                    "write_only": True,
                }
            )
            result = await connection.execute(
                text(_UPDATE_ORGANIZATION_SECRET_SQL),
                {
                    "organization_id": organization_id,
                    "secret_id": secret_id,
                    "name": payload_dto.header.name,
                    "description": payload_dto.header.description,
                    "kind": kind.name,
                    "payload": map_create_to_payload(secret_dto=payload_dto),
                    "key": key,
                    "user_id": user_id,
                },
            )
            row = _row(result.mappings().first())
            row.selected_project_ids = stored.selected_project_ids or []
            return _dto(vars(row), with_selected=True)

        return await self._in_transaction(work)

    async def delete_organization_secret(
        self, *, organization_id: UUID, secret_id: UUID
    ) -> Optional[OrganizationSecretDeleted]:
        try:
            async with self.engine.transaction() as connection:
                result = await connection.execute(
                    text(_DELETE_ORGANIZATION_SECRET_SQL),
                    {"organization_id": organization_id, "secret_id": secret_id},
                )
                row = result.mappings().first()
                if row is None:
                    return None
                return OrganizationSecretDeleted(
                    secret_id=row["id"],
                    kind=_secret_kind_of(row["kind"]),
                    availability=SecretAvailability(row["availability"]),
                    selected_count=row["selected_count"],
                )
        except DBAPIError as error:
            raise _conflict_from(error) from None

    async def set_organization_secret_availability(
        self,
        *,
        organization_id: UUID,
        secret_id: UUID,
        availability: SecretAvailability,
        project_ids: Sequence[UUID],
        user_id: Optional[UUID],
    ) -> Optional[SecretResponseDTO]:
        key = self._key()
        selected = (
            list(dict.fromkeys(project_ids))
            if availability == SecretAvailability.SELECTED_PROJECTS
            else []
        )

        async def work(connection: AsyncConnection):
            locked = await connection.execute(
                text(_LOCK_ORGANIZATION_SECRET_SQL),
                {
                    "organization_id": organization_id,
                    "secret_id": secret_id,
                    "key": key,
                },
            )
            stored_row = locked.mappings().first()
            if stored_row is None:
                return None
            result = await connection.execute(
                text(_SET_AVAILABILITY_SQL),
                {
                    "organization_id": organization_id,
                    "secret_id": secret_id,
                    "availability": availability.value,
                    "user_id": user_id,
                    "key": key,
                },
            )
            row = _row(result.mappings().first())
            await connection.execute(
                text(_DELETE_SECRET_PROJECTS_SQL), {"secret_id": secret_id}
            )
            await self._write_selected_projects(
                connection,
                organization_id=organization_id,
                secret_id=secret_id,
                project_ids=selected,
                user_id=user_id,
            )
            row.selected_project_ids = sorted(selected)
            return _dto(vars(row), with_selected=True)

        return await self._in_transaction(work)

    async def list_organization_project_ids(
        self, *, organization_id: UUID
    ) -> List[UUID]:
        async with self.engine.session() as session:
            result = await session.execute(
                text(_LIST_ORGANIZATION_PROJECT_IDS_SQL),
                {"organization_id": organization_id},
            )
            return [row[0] for row in result.all()]
