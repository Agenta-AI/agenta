from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict

from ee.src.core.subscriptions.types import Plan


# Plan-based retention periods (in days)
PLAN_RETENTION_DAYS: Dict[str, int] = {
    Plan.CLOUD_V0_HOBBY.value: 7,
    Plan.CLOUD_V0_PRO.value: 30,
    Plan.CLOUD_V0_BUSINESS.value: 90,
    Plan.CLOUD_V0_HUMANITY_LABS.value: 365,
    Plan.CLOUD_V0_X_LABS.value: 365,
    Plan.CLOUD_V0_AGENTA_AI.value: 365,
}


@dataclass
class RetentionConfig:
    plan: str
    retention_days: int
    project_chunk_size: int = 500
    max_traces_per_chunk: int = 5000

    @property
    def cutoff(self) -> datetime:
        return datetime.now(tz=timezone.utc) - timedelta(days=self.retention_days)


@dataclass
class RetentionResult:
    plan: str
    project_chunks: int
    projects_seen: int
    traces_selected: int
    spans_deleted: int
