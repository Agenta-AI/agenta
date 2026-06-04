from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from oss.src.core.evaluations.utils import (
    TraceFetcher,
    make_hash,
    plan_missing_traces,
    select_traces_for_reuse,
)
from oss.src.core.tracing.service import TracingService


class CacheResolution(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    hash_id: Optional[str]
    reusable_traces: List[Any]
    missing_count: int


class RunnableCacheResolver:
    """The tracing service is injected once; per-call values (project_id, the
    cache toggle, the step's references/links) stay method params."""

    def __init__(
        self,
        *,
        tracing_service: TracingService,
    ):
        self.tracing_service = tracing_service
        self._traces = TraceFetcher(tracing_service=tracing_service)

    async def resolve(
        self,
        *,
        project_id: UUID,
        #
        enabled: bool,
        #
        references: Optional[Dict[str, Any]] = None,
        links: Optional[Dict[str, Any]] = None,
        #
        required_count: int = 1,
    ) -> CacheResolution:
        hash_id = make_hash(
            references=references,
            links=links,
        )

        if not enabled or not hash_id or required_count <= 0:
            return CacheResolution(
                hash_id=hash_id,
                reusable_traces=[],
                missing_count=max(0, required_count),
            )

        cached_traces = await self._traces.fetch_traces_by_hash(
            project_id=project_id,
            hash_id=hash_id,
            limit=required_count,
        )
        reusable_traces = select_traces_for_reuse(
            traces=cached_traces,
            required_count=required_count,
        )

        return CacheResolution(
            hash_id=hash_id,
            reusable_traces=reusable_traces,
            missing_count=plan_missing_traces(
                required_count=required_count,
                reusable_count=len(reusable_traces),
            ),
        )
