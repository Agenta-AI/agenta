from typing import List, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from oss.src.core.transcripts.dtos import Transcript, TranscriptEvent
from oss.src.core.transcripts.interfaces import TranscriptsDAOInterface
from oss.src.dbs.postgres.transcripts.dbes import TranscriptDBE
from oss.src.dbs.postgres.transcripts.mappings import (
    map_transcript_event_to_dbe,
    map_transcript_dbe_to_dto,
)
from oss.src.dbs.postgres.shared.engine import AnalyticsEngine, get_analytics_engine


class TranscriptsDAO(TranscriptsDAOInterface):
    def __init__(self, engine: AnalyticsEngine = None):
        if engine is None:
            engine = get_analytics_engine()
        self.engine = engine

    async def append(
        self,
        *,
        event: TranscriptEvent,
    ) -> Optional[Transcript]:
        async with self.engine.session() as session:
            dbe = map_transcript_event_to_dbe(event=event)

            values = {
                c.name: getattr(dbe, c.name)
                for c in TranscriptDBE.__table__.columns
                if not (getattr(dbe, c.name) is None and c.server_default is not None)
            }

            stmt = insert(TranscriptDBE).values(**values).returning(TranscriptDBE)
            result = await session.execute(stmt)
            await session.commit()

            row = result.scalars().first()
            if row is None:
                return None
            return map_transcript_dbe_to_dto(dbe=row)

    async def get_transcript(
        self,
        *,
        project_id: UUID,
        session_id: UUID,
    ) -> List[Transcript]:
        async with self.engine.session() as session:
            stmt = (
                select(TranscriptDBE)
                .where(
                    TranscriptDBE.project_id == project_id,
                    TranscriptDBE.session_id == session_id,
                )
                .order_by(TranscriptDBE.id.asc())
            )

            dbes = (await session.execute(stmt)).scalars().all()
            return [map_transcript_dbe_to_dto(dbe=dbe) for dbe in dbes]

    async def get_event(
        self,
        *,
        project_id: UUID,
        event_id: UUID,
    ) -> Optional[Transcript]:
        async with self.engine.session() as session:
            stmt = select(TranscriptDBE).where(
                TranscriptDBE.project_id == project_id,
                TranscriptDBE.id == event_id,
            )

            dbe = (await session.execute(stmt)).scalars().first()
            if dbe is None:
                return None
            return map_transcript_dbe_to_dto(dbe=dbe)
