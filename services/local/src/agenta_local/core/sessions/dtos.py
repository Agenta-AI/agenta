"""Session-domain records and enums."""

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel


class SessionStatus(StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class MessageRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class TurnStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    INTERRUPTED = "interrupted"


class Session(BaseModel):
    id: str
    agent_revision_id: str
    title: str | None
    status: SessionStatus
    created_at: datetime
    updated_at: datetime


class Message(BaseModel):
    id: str
    session_id: str
    turn_id: str
    sequence: int
    role: MessageRole
    content: dict[str, Any]
    created_at: datetime


class Turn(BaseModel):
    id: str
    session_id: str
    client_turn_id: str
    input_hash: str
    status: TurnStatus
    error: dict[str, Any] | None
    started_at: datetime | None
    finished_at: datetime | None
