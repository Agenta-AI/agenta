"""Postgres storage of the vault, addressed by owner (M5).

Every method takes a `SecretOwner` and maps its kind to the typed column. Project and
organization rows live in two slug spaces (`uq_secrets_project_id_slug`,
`uq_secrets_organization_id_slug`).

Two rules hold for every write here:

- Errors carry no values. A secrets write binds the plaintext JSON as a parameter of
  `pgp_sym_encrypt`, so a driver error (and its traceback) quotes the credential. Every
  `DBAPIError` becomes a domain error raised `from None`.
- An organization connection is addressed with `shareable=True`
  (`kind IN ORGANIZATION_SECRET_KINDS AND project_id IS NULL`), so an SSO row is never
  listed, read, changed or deleted as one.

A project row and an organization row with the same slug are two separate connections. An
agent names the one it uses by scope and slug, so no write checks one against the other.
"""

from types import SimpleNamespace
from datetime import datetime, timezone
from typing import Callable, List, Optional, Sequence
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from oss.src.core.secrets.context import get_data_encryption_key
from oss.src.core.secrets.dtos import (
    CachedEffectiveSecrets,
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
from oss.src.dbs.postgres.secrets.dbes import SecretProjectDBE, SecretsDBE
from oss.src.dbs.postgres.secrets.mappings import (
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


def _owner_filter(owner: SecretOwner, *, shareable: bool = False) -> list:
    columns = owner_columns(owner)
    if "project_id" in columns:
        return [SecretsDBE.project_id == owner.id]
    filters = [SecretsDBE.organization_id == owner.id, SecretsDBE.project_id.is_(None)]
    if shareable:
        filters.append(SecretsDBE.kind.in_(sorted(ORGANIZATION_SECRET_KINDS)))
    return filters


# The projects an organization connection is limited to, read in the same statement.
_SELECTED_PROJECT_IDS = func.array(
    select(SecretProjectDBE.project_id)
    .where(SecretProjectDBE.secret_id == SecretsDBE.id)
    .order_by(SecretProjectDBE.project_id)
    .scalar_subquery()
).label("selected_project_ids")


def _shareable_dto(secrets_dbe: SecretsDBE, selected) -> SecretResponseDTO:
    limited = secrets_dbe.availability == SecretAvailability.SELECTED_PROJECTS.value
    return map_secrets_dbe_to_dto(
        secrets_dbe=secrets_dbe,
        selected_project_ids=list(selected or []) if limited else None,
    )


def _dto(mapping) -> SecretResponseDTO:
    return map_secrets_dbe_to_dto(secrets_dbe=SimpleNamespace(**dict(mapping)))


def _conflict_from(
    error: DBAPIError, *, create_secret_dto=None, owner: Optional[SecretOwner] = None
) -> Exception:
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
                provider=getattr(provider, "value", provider),
                owner=owner.kind.value if owner is not None else "project",
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
        availability: Optional[SecretAvailability] = None,
        project_ids: Sequence[UUID] = (),
        user_id: Optional[UUID] = None,
    ) -> SecretResponseDTO:
        columns = owner_columns(owner)

        secrets_dbe = map_secrets_dto_to_dbe(
            project_id=columns.get("project_id"),
            organization_id=columns.get("organization_id"),
            secret_dto=create_secret_dto,
            management=management,
        )
        selected = (
            list(dict.fromkeys(project_ids))
            if availability == SecretAvailability.SELECTED_PROJECTS
            else []
        )
        if availability is not None:
            secrets_dbe.availability = availability.value
            secrets_dbe.created_by_id = user_id
        try:
            async with self.engine.session() as session:
                session.add(secrets_dbe)
                if selected:
                    await session.flush()
                    await self._write_selected_projects(
                        session,
                        organization_id=owner.id,
                        secret_id=secrets_dbe.id,
                        project_ids=selected,
                        user_id=user_id,
                    )
                await session.commit()
        except DBAPIError as error:
            raise _conflict_from(
                error, create_secret_dto=create_secret_dto, owner=owner
            ) from None

        if availability is not None:
            return _shareable_dto(secrets_dbe, sorted(selected))
        return map_secrets_dbe_to_dto(secrets_dbe=secrets_dbe)

    async def get_by_id(
        self,
        *,
        owner: SecretOwner,
        secret_id: UUID,
        shareable: bool = False,
    ) -> Optional[SecretResponseDTO]:
        async with self.engine.session() as session:
            if shareable:
                result = await session.execute(
                    select(SecretsDBE, _SELECTED_PROJECT_IDS).where(
                        SecretsDBE.id == secret_id,
                        *_owner_filter(owner, shareable=True),
                    )
                )
                row = result.first()
                return _shareable_dto(*row) if row is not None else None

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

    async def list(
        self, *, owner: SecretOwner, shareable: bool = False
    ) -> List[SecretResponseDTO]:
        async with self.engine.session() as session:
            if shareable:
                result = await session.execute(
                    select(SecretsDBE, _SELECTED_PROJECT_IDS)
                    .where(*_owner_filter(owner, shareable=True))
                    .order_by(SecretsDBE.created_at, SecretsDBE.id)
                )
                return [_shareable_dto(*row) for row in result.all()]

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
        shareable: bool = False,
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
                    shareable=shareable,
                )
        except DBAPIError as error:
            raise _conflict_from(error) from None

    @staticmethod
    async def _locked(
        session: AsyncSession, *, owner: SecretOwner, secret_id: UUID, shareable: bool
    ):
        """The row under `FOR UPDATE` and, for an organization connection, its selected
        projects (same statement). None when the owner holds no such row."""
        columns = (SecretsDBE, _SELECTED_PROJECT_IDS) if shareable else (SecretsDBE,)
        result = await session.execute(
            select(*columns)
            .where(
                SecretsDBE.id == secret_id, *_owner_filter(owner, shareable=shareable)
            )
            .with_for_update(of=SecretsDBE)
        )
        row = result.first()
        if row is None:
            return None, None
        return row[0], (row[1] if shareable else None)

    async def _update_in(
        self,
        session: AsyncSession,
        *,
        owner: SecretOwner,
        secret_id: UUID,
        update_secret_dto: UpdateSecretDTO,
        user_id: Optional[UUID],
        resolve_update,
        shareable: bool = False,
    ) -> Optional[SecretResponseDTO]:
        # FOR UPDATE lets the domain resolver apply immutable policy and carry-over
        # against the latest committed row before this transaction persists the update.
        secrets_dbe, selected = await self._locked(
            session, owner=owner, secret_id=secret_id, shareable=shareable
        )

        if secrets_dbe is None:
            return None

        def dto() -> SecretResponseDTO:
            if shareable:
                return _shareable_dto(secrets_dbe, selected)
            return map_secrets_dbe_to_dto(secrets_dbe=secrets_dbe)

        # Every decision that reads stored state runs HERE, against the locked row.
        # A caller that read the row before this transaction may be holding a snapshot
        # another writer has already replaced; the keep-on-omit carry-over in particular
        # would then write a rotated credential back to its old value.
        if resolve_update is not None:
            resolved = resolve_update(dto(), update_secret_dto)
            # None means the resolver found nothing to change. Returning here leaves the
            # lifecycle columns alone and rolls the transaction back, so a poll that learns
            # nothing costs a read and no write.
            if resolved is None:
                return dto()
            update_secret_dto = resolved

        map_secrets_dto_to_dbe_update(
            secrets_dbe=secrets_dbe,
            update_secret_dto=update_secret_dto,
            user_id=user_id,
        )

        await session.commit()
        await session.refresh(secrets_dbe)

        return dto()

    async def delete(
        self,
        *,
        owner: SecretOwner,
        secret_id: UUID,
        authorize_delete: Optional[Callable[[SecretResponseDTO], None]] = None,
        shareable: bool = False,
    ) -> None:
        try:
            async with self.engine.session() as session:
                vault_secret_dbe, selected = await self._locked(
                    session, owner=owner, secret_id=secret_id, shareable=shareable
                )
                if vault_secret_dbe is None:
                    return

                if authorize_delete is not None:
                    authorize_delete(
                        _shareable_dto(vault_secret_dbe, selected)
                        if shareable
                        else map_secrets_dbe_to_dto(secrets_dbe=vault_secret_dbe)
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

    # -- organization connections: selected projects ---------------------------------

    async def _write_selected_projects(
        self,
        session: AsyncSession,
        *,
        organization_id: UUID,
        secret_id: UUID,
        project_ids: Sequence[UUID],
        user_id: Optional[UUID],
    ) -> None:
        if not project_ids:
            return
        result = await session.execute(
            text(_INSERT_SECRET_PROJECTS_SQL),
            {
                "secret_id": secret_id,
                "project_ids": list(project_ids),
                "organization_id": organization_id,
                "user_id": user_id,
            },
        )
        if result.rowcount != len(project_ids):
            raise ProjectNotInOrganization(project_ids=list(project_ids))

    async def set_availability(
        self,
        *,
        owner: SecretOwner,
        secret_id: UUID,
        availability: SecretAvailability,
        project_ids: Sequence[UUID],
        user_id: Optional[UUID],
    ) -> Optional[SecretResponseDTO]:
        selected = (
            list(dict.fromkeys(project_ids))
            if availability == SecretAvailability.SELECTED_PROJECTS
            else []
        )
        try:
            async with self.engine.session() as session:
                secrets_dbe, _ = await self._locked(
                    session, owner=owner, secret_id=secret_id, shareable=True
                )
                if secrets_dbe is None:
                    return None
                secrets_dbe.availability = availability.value
                secrets_dbe.updated_at = datetime.now(timezone.utc)
                secrets_dbe.updated_by_id = user_id
                await session.execute(
                    text(_DELETE_SECRET_PROJECTS_SQL), {"secret_id": secret_id}
                )
                await self._write_selected_projects(
                    session,
                    organization_id=owner.id,
                    secret_id=secret_id,
                    project_ids=selected,
                    user_id=user_id,
                )
                await session.commit()
        except DBAPIError as error:
            raise _conflict_from(error) from None
        return _shareable_dto(secrets_dbe, sorted(selected))

    async def list_organization_project_ids(
        self, *, organization_id: UUID
    ) -> List[UUID]:
        async with self.engine.session() as session:
            result = await session.execute(
                text(_LIST_ORGANIZATION_PROJECT_IDS_SQL),
                {"organization_id": organization_id},
            )
            return [row[0] for row in result.all()]
