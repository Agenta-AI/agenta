"""Wave 1 wallet stream contracts: version-one Pydantic envelopes for the two dedicated
Redis streams described in `docs/design/wallets-research/v1/entities.md` §"Gateway stream
contracts". These are wire DTOs only — no DB, no Redis, no HTTP.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# Stream names — the only two producers/consumers this package seeds.
STREAM_MEASUREMENTS = "streams:measurements"
STREAM_DEBITS = "streams:debits"

CONTRACT_VERSION = 1


class GatewayKind(str, Enum):
    LLM = "llm"
    MCP = "mcp"
    SBX = "sbx"


class DebitKind(str, Enum):
    GATEWAY_USAGE = "gateway_usage"
    CREDIT_EXPIRY = "credit_expiry"
    CLAWBACK = "clawback"
    REFUND = "refund"
    ADJUSTMENT = "adjustment"


class MeasurementComponentV1(BaseModel):
    """One optional, repeatable metric on a measurement (e.g. `input_tokens`)."""

    key: str
    value: int
    cost_musd: Optional[int] = None


class MeasurementCommandV1(BaseModel):
    """`streams:measurements` envelope, published best-effort by the API request after it
    has the managed gateway result. Contains no unbounded raw provider payload."""

    version: int = CONTRACT_VERSION

    measurement_id: str  # opaque, gateway-minted
    #
    organization_id: Optional[UUID] = None
    project_id: UUID
    user_id: Optional[UUID] = None
    agent_id: Optional[UUID] = None
    #
    gateway_kind: GatewayKind
    request_id: str  # opaque, gateway-minted
    resource_key: str
    resource_locator: Dict[str, Any] = Field(default_factory=dict)
    endpoint_id: Optional[str] = None
    endpoint_kind: str
    #
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    #
    components: List[MeasurementComponentV1] = Field(default_factory=list)
    references: Dict[str, Any] = Field(default_factory=dict)
    #
    created_at: datetime

    @field_validator("components")
    @classmethod
    def _component_keys_are_unique(
        cls, components: List[MeasurementComponentV1]
    ) -> List[MeasurementComponentV1]:
        # Stored values are unique per key and pricing reads every component, so a
        # repeated key would charge an amount the stored measurement cannot explain.
        keys = [component.key for component in components]
        duplicates = sorted({key for key in keys if keys.count(key) > 1})
        if duplicates:
            raise ValueError(f"duplicate component keys: {duplicates}")
        return components


class DebitCommandV1(BaseModel):
    """`streams:debits` envelope, published only by the gateway measurement worker for
    managed use it chooses to charge.

    Deliberately excludes measurement id, metric values, provider cost, request id, and
    workflow references: the gateway has already converted its complete measurement into a
    domain-agnostic amount before this message exists.
    """

    version: int = CONTRACT_VERSION

    idempotency_key: str  # opaque, gateway-minted posting key
    organization_id: UUID
    debit_kind: DebitKind
    amount_musd: int = Field(gt=0)
    pricing_version: str
    resource_key: str
    resource_locator: Dict[str, Any] = Field(default_factory=dict)
    #
    created_at: datetime
