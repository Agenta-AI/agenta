from dataclasses import dataclass
from typing import Any, Dict, List
from uuid import UUID


@dataclass(frozen=True)
class RecordContentConflictDetails:
    project_id: UUID
    record_id: UUID
    session_id: str


class RecordError(Exception):
    code: str
    message: str
    retryable: bool
    next_step: str

    def to_detail(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "next_step": self.next_step,
        }


class RecordContentConflict(RecordError):
    code = "record_conflict"
    message = "A stable record ID already exists with different content."
    retryable = False
    next_step = "Use a new record ID or resend the original content unchanged."

    def __init__(self, conflicts: List[RecordContentConflictDetails]):
        self.conflicts = conflicts
        super().__init__(self.message)

    def to_detail(self) -> Dict[str, Any]:
        detail = super().to_detail()
        detail["details"] = {
            "record_ids": [str(conflict.record_id) for conflict in self.conflicts]
        }
        return detail
