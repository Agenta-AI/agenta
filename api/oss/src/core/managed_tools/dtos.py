"""Managed tool actions: paid actions that run on a provider account Agenta holds.

Design: `docs/design/wallets-research/v2/managed-tools.md`.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, Literal, Optional, Type
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from oss.src.core.tools.dtos import AgentError


class ManagedActionUnit(str, Enum):
    """What is billable, counted by the executor from the validated output."""

    CALLS = "calls"  # one per successful call
    RESULTS = "results"  # the length of the action's `results_field`


class ManagedActionOutcome(str, Enum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    UNKNOWN = "unknown"


class ManagedActionBinding(BaseModel):
    """How one action reaches its upstream. The provider interprets `operation`."""

    model_config = ConfigDict(frozen=True)

    provider: str = Field(min_length=1)
    operation: str = Field(min_length=1)
    # Merged after validation and never advertised: arguments that change what the upstream
    # charges us are ours to set, not the model's.
    fixed_arguments: Dict[str, Any] = Field(default_factory=dict)


class ManagedAction(BaseModel):
    """The public contract of one action. Provider-independent; the price is the wallet's."""

    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    integration: str = Field(pattern=r"^[a-z0-9]+$")
    name: str = Field(pattern=r"^[a-z0-9_]+$")
    description: str = Field(min_length=1)
    #
    input_model: Type[BaseModel]
    output_model: Type[BaseModel]
    #
    binding: ManagedActionBinding
    #
    unit: ManagedActionUnit
    results_field: Optional[str] = None
    #
    read_only: bool = True
    timeout_seconds: float = Field(default=30.0, gt=0)

    @model_validator(mode="after")
    def _counting_rule_is_complete(self) -> "ManagedAction":
        if (self.unit == ManagedActionUnit.RESULTS) != (self.results_field is not None):
            raise ValueError("a RESULTS action names its results_field; others do not")
        if self.results_field is not None:
            field = self.output_model.model_fields.get(self.results_field)
            if (
                field is None
                or getattr(field.annotation, "__origin__", None) is not list
            ):
                raise ValueError(
                    f"results_field {self.results_field!r} is not a list field of the output"
                )
        fixed = set(self.binding.fixed_arguments) & set(self.input_model.model_fields)
        if fixed:
            raise ValueError(f"the model may not set fixed arguments: {sorted(fixed)}")
        return self

    @property
    def key(self) -> str:
        return f"{self.integration}.{self.name}"

    @property
    def tool(self) -> str:
        # Anthropic tool names allow no dot.
        return f"{self.integration}_{self.name}"

    def count_units(self, output: BaseModel) -> int:
        if self.unit == ManagedActionUnit.CALLS:
            return 1
        return len(getattr(output, self.results_field))


class ManagedActionRateLimit(BaseModel):
    """Per organization, on one shared provider: a burst and a refill per minute."""

    model_config = ConfigDict(frozen=True)

    burst: int = Field(gt=0)
    per_minute: int = Field(gt=0)


class ManagedActionContext(BaseModel):
    """Trusted per-call context, from the authenticated scope and the signed gateway
    credential. Never from tool arguments."""

    model_config = ConfigDict(frozen=True)

    organization_id: UUID
    project_id: UUID
    user_id: UUID
    run_id: Optional[str] = None
    session_id: Optional[str] = None
    agent_id: Optional[str] = None
    # Minted by the executor just before dispatch; None until then.
    execution_id: Optional[str] = None


class ManagedActionUpstreamFailure(BaseModel):
    kind: Literal["rate_limited", "auth_failed", "rejected"]
    message: str
    retry_after_ms: Optional[int] = None


class ManagedActionProviderCost(BaseModel):
    """What the upstream says it charged us. Evidence for reconciliation, never priced."""

    unit: str
    amount: float


class ManagedActionResponse(BaseModel):
    """How a provider reports an upstream that answered. Exactly one of `output` and
    `failure`. An upstream that never answered is an exception, not a response."""

    output: Optional[Dict[str, Any]] = None
    failure: Optional[ManagedActionUpstreamFailure] = None
    provider_reference: Optional[str] = None
    provider_cost: Optional[ManagedActionProviderCost] = None

    @model_validator(mode="after")
    def _one_ending(self) -> "ManagedActionResponse":
        if (self.output is None) == (self.failure is None):
            raise ValueError("a response carries exactly one of output and failure")
        return self


class ManagedActionResult(BaseModel):
    execution_id: Optional[str] = None  # None when nothing was dispatched
    output: Optional[Dict[str, Any]] = None
    error: Optional[AgentError] = None


class ManagedActionMeasurement(BaseModel):
    """One dispatched, platform-paid execution, as handed to billing."""

    execution_id: str
    action: str
    provider: str
    unit: ManagedActionUnit
    units: int = Field(ge=0)
    outcome: ManagedActionOutcome
    context: ManagedActionContext
    start_time: datetime
    end_time: datetime
    provider_reference: Optional[str] = None
    provider_cost: Optional[ManagedActionProviderCost] = None


class ManagedActionPrice(BaseModel):
    """The wallet's price for one action, for the listing and for admission."""

    unit: ManagedActionUnit
    musd_per_unit: int
    max_units_per_call: Optional[int] = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _per_result_is_capped(self) -> "ManagedActionPrice":
        # Admission charges against the worst case, which an uncapped count does not have.
        if self.unit == ManagedActionUnit.RESULTS and self.max_units_per_call is None:
            raise ValueError("a per-result price needs max_units_per_call")
        return self

    @property
    def worst_case_musd(self) -> int:
        return self.musd_per_unit * (self.max_units_per_call or 1)
