from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class SandboxUsageDTO(BaseModel):
    """Sandbox resource usage from a single provider billing event or poll."""

    organization_id: UUID
    provider: str  # "e2b" | "daytona"
    sandbox_id: str

    # Physical resource-second quantities (what we store and meter).
    vcpu_seconds: int = 0
    ram_gib_seconds: int = 0
    disk_gib_seconds: int = 0
    gpu_seconds: int = 0

    # E2B: delivery-id header value for idempotency dedupe.
    delivery_id: Optional[str] = None


class SandboxUsageResult(BaseModel):
    accepted: bool
    delivery_id: Optional[str] = None
    deduped: bool = False
