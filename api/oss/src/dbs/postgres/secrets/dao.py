"""Postgres storage of the vault, addressed by owner (M5).

Every method takes a `SecretOwner` and maps its kind to the typed column. Project and
organization rows live in two slug spaces (`uq_secrets_project_id_slug`,
`uq_secrets_organization_id_slug`).

Three rules hold for every write here:

- Errors carry no values. A secrets write binds the plaintext JSON as a parameter of
  `pgp_sym_encrypt`, so a driver error (and its traceback) quotes the credential. Every
  `DBAPIError` becomes a domain error raised `from None`.
- The shadow rule ("no project holds a project row and an available organization row with
  one slug and another kind or provider family") is checked against the database, inside
  the write's own transaction, never against a cache. Those transactions run
  `SERIALIZABLE` (set on the `BEGIN`, no extra statement); a serialization failure is
  retried (`_SERIALIZABLE_ATTEMPTS` attempts in all), then `SecretWriteConflict`.
- The organization operations address inheritable organization rows only
  (`kind IN INHERITABLE_KINDS AND project_id IS NULL`), so an SSO row is never listed,
  read, changed or deleted through them.
"""

import asyncio
import random
from types import SimpleNamespace
from typing import Awaitable, Callable, List, Optional, Sequence, TypeVar
from uuid import UUID

import uuid_utils.compat as uuid_compat
from sqlalchemy import (
    LargeBinary,
    String,
    bindparam,
    cast,
    column,
    func,
    or_,
    select,
    table,
    text,
    type_coerce,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession
from sqlalchemy.orm import aliased

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
    INHERITABLE_KINDS,
    SecretAvailability,
    SecretKind,
    SecretOwnerKind,
)
from oss.src.core.secrets.interfaces import SecretsDAOInterface
from oss.src.core.secrets.managed import SecretManagementDTO
from oss.src.core.secrets.types import (
    ProjectNotInOrganization,
    SecretShadowConflict,
    SecretSlugConflict,
    SecretStorageError,
    SecretWriteConflict,
    SubscriptionProviderConflict,
)
from oss.src.dbs.postgres.secrets.dbes import SecretProjectDBE, SecretsDBE
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

_SERIALIZABLE = "SERIALIZABLE"
_SERIALIZATION_FAILURE = "40001"
_SERIALIZABLE_ATTEMPTS = 6

# Postgres enum labels are the member NAMES.
_INHERITABLE_LABELS = ", ".join(f"'{kind.name}'" for kind in sorted(INHERITABLE_KINDS))

_COLUMNS = (
    "s.id, s.slug, s.kind::text AS kind, pgp_sym_decrypt(s.data, CAST(:key AS TEXT)) AS data, "
    "s.project_id, s.organization_id, s.name, s.description, s.created_at, "
    "s.updated_at, s.availability"
)

# An organization row `o` reaches project `:pid` (or the joined `p.id`).
_AVAILABLE_TO = (
    "(o.availability = 'all_projects' OR EXISTS (SELECT 1 FROM secret_projects sp "
    "WHERE sp.secret_id = o.id AND sp.project_id = {project}))"
)

# The provider family of a stored row, read from the decrypted JSON in SQL.
_FAMILY = "(pgp_sym_decrypt({alias}.data, CAST(:key AS TEXT))::jsonb ->> 'kind')"

# A stored row of alias `{alias}` has another identity than kind :kind / family CAST(:family AS TEXT).
_MISMATCH = (
    "({alias}.kind <> CAST(:kind AS secretkind_enum) OR "
    "(CAST(:kind AS secretkind_enum) = 'PROVIDER_KEY' AND "
    + _FAMILY
    + " IS DISTINCT FROM CAST(:family AS TEXT)))"
)

# ONE statement: the project row's organization, the project's rows, and the inheritable
# organization rows available to the project. An unknown project returns no row.
_LOAD_EFFECTIVE_SQL = f"""
SELECT p.organization_id AS project_organization_id, e.*
FROM projects p
LEFT JOIN LATERAL (
    SELECT {_COLUMNS}, false AS inherited FROM secrets s
    WHERE s.project_id = p.id AND s.kind IS NOT NULL
    UNION ALL
    SELECT {_COLUMNS}, true AS inherited FROM secrets s
    WHERE s.project_id IS NULL AND s.organization_id = p.organization_id
      AND s.kind IN ({_INHERITABLE_LABELS})
      AND (s.availability = 'all_projects' OR EXISTS (SELECT 1 FROM secret_projects sp
           WHERE sp.secret_id = s.id AND sp.project_id = p.id))
) e ON true
WHERE p.id = CAST(:project_id AS UUID)
ORDER BY e.inherited, e.created_at, e.id
"""

# A project create with a caller-given slug: the shadow check is folded into the insert.
_INSERT_PROJECT_SECRET_CHECKED_SQL = f"""
INSERT INTO secrets AS s (id, slug, kind, data, project_id, name, description, created_at)
SELECT CAST(:id AS UUID), CAST(:slug AS VARCHAR), CAST(:kind AS secretkind_enum), pgp_sym_encrypt(CAST(:payload AS TEXT), CAST(:key AS TEXT)),
       CAST(:project_id AS UUID), CAST(:name AS VARCHAR), CAST(:description AS VARCHAR), now()
WHERE NOT EXISTS (
    SELECT 1 FROM secrets o JOIN projects p ON p.id = CAST(:project_id AS UUID)
    WHERE o.project_id IS NULL AND o.organization_id = p.organization_id
      AND o.slug = CAST(:slug AS VARCHAR) AND o.kind IN ({_INHERITABLE_LABELS})
      AND {_AVAILABLE_TO.format(project="CAST(:project_id AS UUID)")}
      AND {_MISMATCH.format(alias="o")}
)
RETURNING {_COLUMNS}
"""

# An organization row (kind :kind, family CAST(:family AS TEXT), slug CAST(:slug AS VARCHAR)) would conflict with a
# project row of its organization in a project that it reaches.
_ORGANIZATION_CONFLICTS_SQL = f"""
SELECT 1 FROM secrets s JOIN projects p ON p.id = s.project_id
WHERE p.organization_id = CAST(:organization_id AS UUID) AND s.slug = CAST(:slug AS VARCHAR)
  AND {_MISMATCH.format(alias="s")}
  AND (CAST(:availability AS VARCHAR) = 'all_projects' OR s.project_id = ANY(CAST(:project_ids AS uuid[])))
LIMIT 1
FOR SHARE OF s
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
    f"AND s.kind IN ({_INHERITABLE_LABELS})"
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


_projects = table("projects", column("id"), column("organization_id"))


def _inherited_identity_column():
    """The kind and family of the available organization row a project row's slug would
    shadow, as one scalar (`<KIND LABEL>:<family>`), for the user-update lock read."""
    o = aliased(SecretsDBE, name="o")
    family = cast(
        func.pgp_sym_decrypt(
            type_coerce(o.data, LargeBinary), bindparam("key", type_=String)
        ),
        JSONB,
    )["kind"].astext
    identity = func.concat(cast(o.kind, String), ":", func.coalesce(family, ""))
    return (
        select(identity)
        .select_from(o)
        .join(_projects, _projects.c.id == SecretsDBE.project_id)
        .where(
            o.project_id.is_(None),
            o.organization_id == _projects.c.organization_id,
            o.slug == SecretsDBE.slug,
            o.kind.in_(sorted(INHERITABLE_KINDS)),
            or_(
                o.availability == SecretAvailability.ALL_PROJECTS.value,
                # Correlated explicitly: auto-correlation does not reach the outermost
                # `secrets` through the scalar subquery, and an uncorrelated EXISTS
                # would treat every limited row as available.
                select(SecretProjectDBE.secret_id)
                .where(
                    SecretProjectDBE.secret_id == o.id,
                    SecretProjectDBE.project_id == SecretsDBE.project_id,
                )
                .correlate_except(SecretProjectDBE)
                .exists(),
            ),
        )
        .limit(1)
        .correlate(SecretsDBE)
        .scalar_subquery()
        .label("inherited")
    )


async def _wait_before_retry(attempt: int) -> None:
    # Exponential with jitter: 5 to 10 ms on the first wait, up to 160 ms on the fifth.
    await asyncio.sleep(random.uniform(0.5, 1.0) * 0.01 * (2 ** (attempt - 1)))


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


def _sqlstate(error: DBAPIError) -> Optional[str]:
    orig = getattr(error, "orig", None)
    return getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)


def _family(data) -> Optional[str]:
    kind = getattr(data, "kind", None)
    if kind is None:
        return None
    return str(getattr(kind, "value", kind))


def _inherited_identity_matches(*, inherited: Optional[str], kind, data) -> bool:
    if inherited is None:
        return True
    label, _, family = inherited.partition(":")
    if label != kind.name:
        return False
    if kind == SecretKind.PROVIDER_KEY:
        return family == (_family(data) or "")
    return True


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

    async def _serializable(
        self,
        work: Callable[[AsyncConnection], Awaitable[_Result]],
        *,
        operation: str,
        ids: dict[str, Optional[UUID]],
        create_secret_dto: Optional[CreateSecretDTO] = None,
    ) -> _Result:
        """Run `work` in one SERIALIZABLE transaction, retried on a serialization failure
        (`_SERIALIZABLE_ATTEMPTS` in all, with a short random wait), then
        `SecretWriteConflict`. Domain errors raised by `work` roll it back and pass
        through.

        Postgres tracks serializable reads by index page, so two organization writes in
        different organizations whose index entries share a page can abort one another
        without a real conflict. The retries absorb that; a real conflict still ends in
        409 or in the domain refusal its retry finds. Each retry is logged at debug with
        the operation name and the row ids only."""
        for attempt in range(1, _SERIALIZABLE_ATTEMPTS + 1):
            try:
                async with self.engine.transaction(
                    isolation_level=_SERIALIZABLE
                ) as connection:
                    return await work(connection)
            except DBAPIError as error:
                if _sqlstate(error) == _SERIALIZATION_FAILURE:
                    if attempt < _SERIALIZABLE_ATTEMPTS:
                        log.debug(
                            "[secrets] serializable write retried",
                            operation=operation,
                            attempt=attempt,
                            **{
                                name: str(value)
                                for name, value in ids.items()
                                if value is not None
                            },
                        )
                        await _wait_before_retry(attempt)
                        continue
                    raise SecretWriteConflict() from None
                raise _conflict_from(
                    error, create_secret_dto=create_secret_dto
                ) from None
        raise SecretWriteConflict()  # pragma: no cover - the loop always returns or raises

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
        check_shadow: bool = False,
    ) -> SecretResponseDTO:
        columns = owner_columns(owner)

        if check_shadow and owner.kind == SecretOwnerKind.PROJECT:
            return await self._create_project_secret_checked(
                project_id=owner.id,
                create_secret_dto=create_secret_dto,
                management=management,
            )

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

    async def _create_project_secret_checked(
        self,
        *,
        project_id: UUID,
        create_secret_dto: CreateSecretDTO,
        management: Optional[SecretManagementDTO],
    ) -> SecretResponseDTO:
        kind = create_secret_dto.secret.kind
        params = {
            "id": uuid_compat.uuid7(),
            "slug": create_secret_dto.slug,
            "kind": kind.name,
            "family": _family(create_secret_dto.secret.data),
            "payload": map_create_to_payload(
                secret_dto=create_secret_dto, management=management
            ),
            "key": self._key(),
            "project_id": project_id,
            "name": create_secret_dto.header.name if create_secret_dto.header else None,
            "description": (
                create_secret_dto.header.description
                if create_secret_dto.header
                else None
            ),
        }

        async def work(connection: AsyncConnection):
            result = await connection.execute(
                text(_INSERT_PROJECT_SECRET_CHECKED_SQL), params
            )
            row = result.mappings().first()
            if row is None:
                raise SecretShadowConflict(slug=create_secret_dto.slug or "")
            return _dto(row)

        return await self._serializable(
            work,
            operation="create_project_secret",
            ids={"project_id": project_id},
            create_secret_dto=create_secret_dto,
        )

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
        check_shadow: bool = False,
    ) -> Optional[SecretResponseDTO]:
        if check_shadow and owner.kind == SecretOwnerKind.PROJECT:

            async def work(connection: AsyncConnection):
                session = AsyncSession(bind=connection, expire_on_commit=False)
                try:
                    return await self._update_in(
                        session,
                        owner=owner,
                        secret_id=secret_id,
                        update_secret_dto=update_secret_dto,
                        user_id=user_id,
                        resolve_update=resolve_update,
                        check_shadow=True,
                    )
                finally:
                    await session.close()

            return await self._serializable(
                work,
                operation="update_project_secret",
                ids={"project_id": owner.id, "secret_id": secret_id},
            )

        try:
            async with self.engine.session() as session:
                return await self._update_in(
                    session,
                    owner=owner,
                    secret_id=secret_id,
                    update_secret_dto=update_secret_dto,
                    user_id=user_id,
                    resolve_update=resolve_update,
                    check_shadow=False,
                    commit=True,
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
        check_shadow: bool,
        commit: bool = False,
    ) -> Optional[SecretResponseDTO]:
        # FOR UPDATE lets the domain resolver apply immutable policy and carry-over
        # against the latest committed row before this transaction persists the update.
        # With `check_shadow`, the same read also returns the identity of the available
        # organization row this row's slug shadows (no extra statement).
        columns = [SecretsDBE]
        params = {}
        if check_shadow:
            columns.append(_inherited_identity_column())
            params = {"key": self._key()}
        stmt = (
            select(*columns)
            .where(SecretsDBE.id == secret_id, *_owner_filter(owner))
            .with_for_update(of=SecretsDBE)
        )
        result = await session.execute(stmt, params)
        row = result.first()

        if row is None:
            return None

        secrets_dbe = row[0]
        inherited = row[1] if check_shadow else None

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

        if (
            check_shadow
            and update_secret_dto.secret is not None
            and not _inherited_identity_matches(
                inherited=inherited,
                kind=update_secret_dto.secret.kind,
                data=update_secret_dto.secret.data,
            )
        ):
            raise SecretShadowConflict(slug=secrets_dbe.slug or "")

        map_secrets_dto_to_dbe_update(
            secrets_dbe=secrets_dbe,
            update_secret_dto=update_secret_dto,
            user_id=user_id,
        )

        if commit:
            await session.commit()
        else:
            await session.flush()
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
        inherited: List[SecretResponseDTO] = []
        for row in rows:
            if row["id"] is None:  # a project with no rows: the LEFT JOIN's empty match
                continue
            (inherited if row["inherited"] else secrets).append(_dto(row))

        return CachedEffectiveSecrets(
            project_id=project_id,
            organization_id=rows[0]["project_organization_id"],
            secrets=secrets,
            inherited=inherited,
        )

    # -- organization credentials (inheritable kinds only) ---------------------------

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

    async def _check_organization_conflicts(
        self,
        connection: AsyncConnection,
        *,
        organization_id: UUID,
        slug: Optional[str],
        kind: SecretKind,
        data,
        availability: SecretAvailability,
        project_ids: Sequence[UUID],
    ) -> None:
        if not slug:
            return
        result = await connection.execute(
            text(_ORGANIZATION_CONFLICTS_SQL),
            {
                "organization_id": organization_id,
                "slug": slug,
                "kind": kind.name,
                "family": _family(data),
                "availability": availability.value,
                "project_ids": list(project_ids),
                "key": self._key(),
            },
        )
        if result.first() is not None:
            raise SecretShadowConflict(slug=slug)

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
        if kind not in INHERITABLE_KINDS:
            raise ValueError("Only inheritable kinds are organization credentials.")
        selected = (
            list(dict.fromkeys(project_ids))
            if availability == SecretAvailability.SELECTED_PROJECTS
            else []
        )

        async def work(connection: AsyncConnection):
            await self._check_organization_conflicts(
                connection,
                organization_id=organization_id,
                slug=create_secret_dto.slug,
                kind=kind,
                data=create_secret_dto.secret.data,
                availability=availability,
                project_ids=selected,
            )
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

        return await self._serializable(
            work,
            operation="create_organization_secret",
            ids={"organization_id": organization_id},
            create_secret_dto=create_secret_dto,
        )

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
                INHERITABLE_KINDS
            ):
                raise ValueError("Only inheritable kinds are organization credentials.")

            kind = resolved.secret.kind if resolved.secret else stored.kind
            data = resolved.secret.data if resolved.secret else stored.data
            await self._check_organization_conflicts(
                connection,
                organization_id=organization_id,
                slug=stored.slug,
                kind=kind,
                data=data,
                availability=stored.availability or SecretAvailability.ALL_PROJECTS,
                project_ids=stored.selected_project_ids or [],
            )

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

        return await self._serializable(
            work,
            operation="update_organization_secret",
            ids={"organization_id": organization_id, "secret_id": secret_id},
        )

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
            stored = _dto(stored_row, with_selected=True)

            await self._check_organization_conflicts(
                connection,
                organization_id=organization_id,
                slug=stored.slug,
                kind=stored.kind,
                data=stored.data,
                availability=availability,
                project_ids=selected,
            )
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

        return await self._serializable(
            work,
            operation="set_organization_secret_availability",
            ids={"organization_id": organization_id, "secret_id": secret_id},
        )

    async def list_organization_project_ids(
        self, *, organization_id: UUID
    ) -> List[UUID]:
        async with self.engine.session() as session:
            result = await session.execute(
                text(_LIST_ORGANIZATION_PROJECT_IDS_SQL),
                {"organization_id": organization_id},
            )
            return [row[0] for row in result.all()]
