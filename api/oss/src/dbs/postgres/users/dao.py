from uuid import UUID
from typing import Optional, List
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from oss.src.dbs.postgres.shared.engine import engine
from oss.src.dbs.postgres.users.dbes import UserIdentityDBE
from oss.src.dbs.postgres.users.mappings import (
    map_identity_dbe_to_dto,
    map_create_dto_to_dbe,
)
from oss.src.core.users.types import UserIdentity, UserIdentityCreate


class IdentitiesDAO:
    async def create(self, dto: UserIdentityCreate) -> UserIdentity:
        identity_dbe = map_create_dto_to_dbe(dto)

        async with engine.core_session() as session:
            try:
                session.add(identity_dbe)
                await session.commit()
                await session.refresh(identity_dbe)
            except IntegrityError:
                await session.rollback()
                stmt = select(UserIdentityDBE).filter_by(
                    method=dto.method,
                    subject=dto.subject,
                )
                result = await session.execute(stmt)
                identity_dbe = result.scalar()
                if identity_dbe is None:
                    raise

        return map_identity_dbe_to_dto(identity_dbe)

    async def get_by_method_subject(
        self, method: str, subject: str
    ) -> Optional[UserIdentity]:
        async with engine.core_session() as session:
            stmt = select(UserIdentityDBE).filter_by(
                method=method,
                subject=subject,
            )
            result = await session.execute(stmt)
            identity_dbe = result.scalar()

            if identity_dbe is None:
                return None

            return map_identity_dbe_to_dto(identity_dbe)

    async def list_by_user(self, user_id: UUID) -> List[UserIdentity]:
        async with engine.core_session() as session:
            stmt = select(UserIdentityDBE).filter_by(user_id=user_id)
            result = await session.execute(stmt)
            identity_dbes = result.scalars().all()

            return [map_identity_dbe_to_dto(dbe) for dbe in identity_dbes]

    async def list_by_domain(self, domain: str) -> List[UserIdentity]:
        async with engine.core_session() as session:
            stmt = select(UserIdentityDBE).filter_by(domain=domain)
            result = await session.execute(stmt)
            identity_dbes = result.scalars().all()

            return [map_identity_dbe_to_dto(dbe) for dbe in identity_dbes]
