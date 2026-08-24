from typing import Callable, Optional
from uuid import UUID

from oss.src.dbs.postgres.secrets.dbes import SecretsDBE
from oss.src.core.secrets.interfaces import SecretsDAOInterface
from oss.src.core.secrets.managed import SecretManagementDTO

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)

from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    SecretResponseDTO,
    UpdateSecretDTO,
)
from oss.src.dbs.postgres.secrets.mappings import (
    map_secrets_dto_to_dbe,
    map_secrets_dbe_to_dto,
    map_secrets_dto_to_dbe_update,
)

from sqlalchemy import select


class SecretsDAO(SecretsDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    @staticmethod
    def _validate_scope(project_id: UUID | None, organization_id: UUID | None) -> None:
        if bool(project_id) == bool(organization_id):
            raise ValueError(
                "Exactly one of project_id or organization_id must be provided."
            )

    @staticmethod
    def _scope_filter(project_id: UUID | None, organization_id: UUID | None) -> dict:
        SecretsDAO._validate_scope(project_id, organization_id)
        return (
            {"project_id": project_id}
            if project_id
            else {"organization_id": organization_id}
        )

    async def create(
        self,
        project_id: UUID | None,
        organization_id: UUID | None,
        create_secret_dto: CreateSecretDTO,
        management: SecretManagementDTO | None = None,
    ):
        self._validate_scope(project_id, organization_id)
        secrets_dbe = map_secrets_dto_to_dbe(
            project_id=project_id,
            organization_id=organization_id,
            secret_dto=create_secret_dto,
            management=management,
        )
        async with self.engine.session() as session:
            session.add(secrets_dbe)
            await session.commit()

        secrets_dto = map_secrets_dbe_to_dto(secrets_dbe=secrets_dbe)
        return secrets_dto

    async def get_by_id(
        self,
        secret_id: UUID,
        project_id: UUID | None,
        organization_id: UUID | None,
    ):
        async with self.engine.session() as session:
            scope_filter = self._scope_filter(project_id, organization_id)
            stmt = select(SecretsDBE).filter_by(
                id=secret_id,
                **scope_filter,
            )
            result = await session.execute(stmt)  # type: ignore
            secrets_dbe = result.scalar()

            if secrets_dbe is None:
                return None

            secrets_dto = map_secrets_dbe_to_dto(secrets_dbe=secrets_dbe)
            return secrets_dto

    async def get_by_slug(
        self,
        secret_slug: str,
        project_id: UUID | None,
        organization_id: UUID | None,
    ):
        async with self.engine.session() as session:
            scope_filter = self._scope_filter(project_id, organization_id)
            stmt = select(SecretsDBE).filter_by(
                slug=secret_slug,
                **scope_filter,
            )
            result = await session.execute(stmt)  # type: ignore
            secrets_dbe = result.scalar()

            if secrets_dbe is None:
                return None

            return map_secrets_dbe_to_dto(secrets_dbe=secrets_dbe)

    async def list(self, project_id: UUID | None, organization_id: UUID | None):
        async with self.engine.session() as session:
            scope_filter = self._scope_filter(project_id, organization_id)
            stmt = (
                select(SecretsDBE)
                .filter_by(**scope_filter)
                .order_by(SecretsDBE.created_at.asc(), SecretsDBE.id.asc())
            )

            results = await session.execute(stmt)  # type: ignore
            secrets_dbes = results.scalars().all()
            vault_secret_dtos = [
                map_secrets_dbe_to_dto(secrets_dbe=secret_dbe)
                for secret_dbe in secrets_dbes
            ]
            return vault_secret_dtos

    async def update(
        self,
        secret_id: UUID,
        update_secret_dto: UpdateSecretDTO,
        project_id: UUID | None,
        organization_id: UUID | None,
        user_id: UUID | None = None,
        resolve_update: Optional[
            Callable[[SecretResponseDTO, UpdateSecretDTO], UpdateSecretDTO]
        ] = None,
    ):
        async with self.engine.session() as session:
            scope_filter = self._scope_filter(project_id, organization_id)
            # FOR UPDATE lets the domain resolver apply immutable policy and carry-over
            # against the latest committed row before this transaction persists the update.
            stmt = (
                select(SecretsDBE)
                .filter_by(
                    id=secret_id,
                    **scope_filter,
                )
                .with_for_update()
            )
            result = await session.execute(stmt)
            secrets_dbe = result.scalar()

            if secrets_dbe is None:
                return None

            # Every decision that reads stored state runs HERE, against the locked row.
            # A caller that read the row before this transaction may be holding a
            # snapshot another writer has already replaced; the keep-on-omit carry-over
            # in particular would then write a rotated credential back to its old value.
            if resolve_update is not None:
                update_secret_dto = resolve_update(
                    map_secrets_dbe_to_dto(secrets_dbe=secrets_dbe),
                    update_secret_dto,
                )

            map_secrets_dto_to_dbe_update(
                secrets_dbe=secrets_dbe,
                update_secret_dto=update_secret_dto,
                user_id=user_id,
            )

            await session.commit()
            await session.refresh(secrets_dbe)

            updated_secrets_dto = map_secrets_dbe_to_dto(secrets_dbe=secrets_dbe)
            return updated_secrets_dto

    async def delete(
        self,
        secret_id: UUID,
        project_id: UUID | None,
        organization_id: UUID | None,
        authorize_delete: Optional[Callable[[SecretResponseDTO], None]] = None,
    ):
        async with self.engine.session() as session:
            scope_filter = self._scope_filter(project_id, organization_id)
            stmt = (
                select(SecretsDBE)
                .filter_by(
                    id=secret_id,
                    **scope_filter,
                )
                .with_for_update()
            )
            result = await session.execute(stmt)  # type: ignore
            vault_secret_dbe = result.scalar()
            if vault_secret_dbe is None:
                return

            if authorize_delete is not None:
                authorize_delete(map_secrets_dbe_to_dto(secrets_dbe=vault_secret_dbe))

            await session.delete(vault_secret_dbe)
            await session.commit()
