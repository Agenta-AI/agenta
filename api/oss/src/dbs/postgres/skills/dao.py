from typing import List, Optional
from uuid import UUID

import uuid_utils.compat as uuid_utils
from sqlalchemy import select

from oss.src.core.shared.dtos import Windowing
from oss.src.core.skills.sources_dtos import (
    SkillSource,
    SkillSourceCreate,
    SkillSourceLink,
    SkillSourceLinkCreate,
)
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.shared.utils import apply_windowing
from oss.src.dbs.postgres.skills.dbes import SkillSourceDBE, SkillSourceLinkDBE


def _source_dto(dbe: SkillSourceDBE) -> SkillSource:
    return SkillSource(
        id=dbe.id,
        slug=dbe.slug,
        repo_url=dbe.repo_url,
        ref=dbe.ref,
        last_seen_commit_sha=dbe.last_seen_commit_sha,
        sync_enabled=bool(dbe.sync_enabled),
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
    )


def _link_dto(dbe: SkillSourceLinkDBE) -> SkillSourceLink:
    return SkillSourceLink(
        id=dbe.id,
        source_id=dbe.source_id,
        workflow_id=dbe.workflow_id,
        path_in_repo=dbe.path_in_repo,
        imported_commit_sha=dbe.imported_commit_sha,
        content_hash=dbe.content_hash,
        detached=bool(dbe.detached),
        missing_in_source=bool(dbe.missing_in_source),
    )


class SkillSourcesDAO:
    def __init__(self, engine: Optional[TransactionsEngine] = None):
        self.engine = engine or get_transactions_engine()

    async def create_source(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        source_create: SkillSourceCreate,
    ) -> SkillSource:
        async with self.engine.session() as session:
            dbe = SkillSourceDBE(
                project_id=project_id,
                id=uuid_utils.uuid7(),
                created_by_id=user_id,
                slug=source_create.slug,
                repo_url=source_create.repo_url,
                ref=source_create.ref,
                last_seen_commit_sha=source_create.last_seen_commit_sha,
                sync_enabled=source_create.sync_enabled,
            )
            session.add(dbe)
            await session.commit()
            return _source_dto(dbe)

    async def fetch_source(
        self,
        *,
        project_id: UUID,
        source_id: UUID,
    ) -> Optional[SkillSource]:
        async with self.engine.session() as session:
            result = await session.execute(
                select(SkillSourceDBE).filter(
                    SkillSourceDBE.project_id == project_id,
                    SkillSourceDBE.id == source_id,
                    SkillSourceDBE.deleted_at.is_(None),
                )
            )
            dbe = result.scalar_one_or_none()
            return _source_dto(dbe) if dbe else None

    async def list_sources(
        self,
        *,
        project_id: UUID,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[SkillSource]:
        async with self.engine.session() as session:
            stmt = select(SkillSourceDBE).filter(
                SkillSourceDBE.project_id == project_id,
                SkillSourceDBE.deleted_at.is_(None),
            )
            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=SkillSourceDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )
            result = await session.execute(stmt)
            return [_source_dto(dbe) for dbe in result.scalars().all()]

    async def create_links(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        link_creates: List[SkillSourceLinkCreate],
    ) -> List[SkillSourceLink]:
        async with self.engine.session() as session:
            dbes = [
                SkillSourceLinkDBE(
                    project_id=project_id,
                    id=uuid_utils.uuid7(),
                    created_by_id=user_id,
                    source_id=link.source_id,
                    workflow_id=link.workflow_id,
                    path_in_repo=link.path_in_repo,
                    imported_commit_sha=link.imported_commit_sha,
                    content_hash=link.content_hash,
                )
                for link in link_creates
            ]
            session.add_all(dbes)
            await session.commit()
            return [_link_dto(dbe) for dbe in dbes]

    async def list_links(
        self,
        *,
        project_id: UUID,
        source_id: UUID,
    ) -> List[SkillSourceLink]:
        async with self.engine.session() as session:
            result = await session.execute(
                select(SkillSourceLinkDBE).filter(
                    SkillSourceLinkDBE.project_id == project_id,
                    SkillSourceLinkDBE.source_id == source_id,
                    SkillSourceLinkDBE.deleted_at.is_(None),
                )
            )
            return [_link_dto(dbe) for dbe in result.scalars().all()]
