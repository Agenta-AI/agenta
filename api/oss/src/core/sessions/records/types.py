from dataclasses import dataclass
from typing import List
from uuid import UUID


@dataclass(frozen=True)
class RecordContentConflictDetails:
    project_id: UUID
    record_id: UUID
    session_id: str


class RecordContentConflict(Exception):
    def __init__(self, conflicts: List[RecordContentConflictDetails]):
        self.conflicts = conflicts
        super().__init__("a stable record id was retried with different content")
