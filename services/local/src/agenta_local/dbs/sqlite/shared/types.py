from datetime import UTC, datetime
from uuid import uuid4


def utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def new_id(prefix: str) -> str:
    """Application-generated record ID (contracts.md: UUID strings)."""
    return f"{prefix}_{uuid4().hex}"
