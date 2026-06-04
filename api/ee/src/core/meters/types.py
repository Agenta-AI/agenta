from typing import Optional, Any

from uuid import UUID, uuid5, NAMESPACE_DNS
from enum import Enum
from datetime import date

from pydantic import BaseModel, model_validator

from oss.src.utils.logging import get_module_logger

from ee.src.core.entitlements.types import Counter, Gauge
from ee.src.core.subscriptions.types import SubscriptionDTO


log = get_module_logger(__name__)


# Frozen at import time. The namespace is the stable project-wide root
# (uuid5(NAMESPACE_DNS, "agenta")) sub-namespaced under "meters".
AGENTA_METERS_NAMESPACE_UUID = uuid5(uuid5(NAMESPACE_DNS, "agenta"), "meters")


class Meters(str, Enum):
    # COUNTERS
    EVALUATIONS_RUN = Counter.EVALUATIONS_RUN.value
    TRACES_INGESTED = Counter.TRACES_INGESTED.value
    TRACES_RETRIEVED = Counter.TRACES_RETRIEVED.value
    CREDITS_CONSUMED = Counter.CREDITS_CONSUMED.value
    EVENTS_INGESTED = Counter.EVENTS_INGESTED.value
    # GAUGES
    USERS = Gauge.USERS.value


class MeterScope(BaseModel):
    """Scope dimensions for a meter row.

    `organization_id` is the tenant root — when set, every finer dimension
    (`workspace -> project -> user`) requires the next one above it.
    `None` on any dimension means "this dimension does not apply" — never
    "default".
    """

    organization_id: Optional[UUID] = None
    workspace_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    user_id: Optional[UUID] = None

    @model_validator(mode="after")
    def _validate_hierarchy(self) -> "MeterScope":
        if self.user_id is not None and self.project_id is None:
            raise ValueError("user_id requires project_id")
        if self.project_id is not None and self.workspace_id is None:
            raise ValueError("project_id requires workspace_id")
        if self.workspace_id is not None and self.organization_id is None:
            raise ValueError("workspace_id requires organization_id")

        return self


class MeterPeriod(BaseModel):
    """Optional period bucket for a meter row.

    `None` means "non-periodic" (a gauge). The hierarchy `year -> month -> day`
    is required: setting a finer-grained component requires the coarser one.
    Daily granularity (year + month + day) must form a real calendar date —
    e.g. 2026-02-30 is rejected.
    """

    year: Optional[int] = None
    month: Optional[int] = None
    day: Optional[int] = None

    @model_validator(mode="after")
    def _validate_hierarchy(self) -> "MeterPeriod":
        if self.day is not None and self.month is None:
            raise ValueError("day requires month")
        if self.month is not None and self.year is None:
            raise ValueError("month requires year")

        if self.month is not None:
            # Use the same `day` value that `date(...)` sees — `self.day`
            # may be `None`, in which case we treat it as 1 (the
            # `MeterPeriod(year=Y, month=M)` shape is "the whole month").
            _day = self.day if self.day is not None else 1
            try:
                date(self.year, self.month, _day)  # type: ignore[arg-type]
            except ValueError as e:
                raise ValueError(
                    f"invalid date {self.year:04d}-{self.month:02d}-{_day:02d}: {e}"  # type: ignore[str-format]
                ) from e

        return self


def compute_meter_id(
    *,
    scope: MeterScope,
    period: MeterPeriod,
    key,
) -> UUID:
    """Compute the deterministic UUIDv5 `meter_id` for a meter row.

    Canonical-form rules — DO NOT CHANGE without a full data re-backfill:
      - `None` means "this dimension does not apply to this meter"; never
        "default". Fields with value `None` are excluded from the canonical
        string entirely.
      - Field-name keys are part of the canonical form (e.g. `"key=traces_ingested"`).
      - Pairs are sorted alphabetically by field name.
      - UUIDs are lowercase 8-4-4-4-12 with no braces or `urn:uuid:` prefix.
      - Integers are plain decimal, no zero-padding.
      - Separator between pairs is `"|"`.

    The function is the *single* source of truth for meter identifiers.
    Every writer (DAO, service helpers, Alembic backfill migrations) MUST go
    through it. There is intentionally no SQL-side mirror.
    """
    # Normalize `key` to its string value if it's an enum.
    key_value = getattr(key, "value", key)

    parts: dict[str, str] = {
        "key": str(key_value),
    }
    if scope.organization_id is not None:
        parts["org"] = str(scope.organization_id).lower()
    if scope.workspace_id is not None:
        parts["wrk"] = str(scope.workspace_id).lower()
    if scope.project_id is not None:
        parts["prj"] = str(scope.project_id).lower()
    if scope.user_id is not None:
        parts["usr"] = str(scope.user_id).lower()
    if period.year is not None:
        parts["y"] = str(int(period.year))
    if period.month is not None:
        parts["m"] = str(int(period.month))
    if period.day is not None:
        parts["d"] = str(int(period.day))

    canonical = "|".join(f"{k}={parts[k]}" for k in sorted(parts.keys()))

    return uuid5(AGENTA_METERS_NAMESPACE_UUID, canonical)


class MeterDTO(BaseModel):
    # Scope dimensions
    organization_id: Optional[UUID] = None
    workspace_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    user_id: Optional[UUID] = None

    # Period dimensions (None = non-periodic gauge)
    year: Optional[int] = None
    month: Optional[int] = None
    day: Optional[int] = None

    # Meter dimensions
    key: Meters
    value: Optional[int] = None
    synced: Optional[int] = None
    delta: Optional[int] = None

    # Deterministic identity derived from (scope, key, period).
    # Optional on construction; populated by the model validator.
    meter_id: Optional[UUID] = None

    subscription: Optional[SubscriptionDTO] = None

    @model_validator(mode="after")
    def _populate_meter_id(self) -> "MeterDTO":
        # Delegate hierarchy + calendar validation to MeterScope / MeterPeriod
        # by constructing them — they raise on invalid input.
        scope = MeterScope(
            organization_id=self.organization_id,
            workspace_id=self.workspace_id,
            project_id=self.project_id,
            user_id=self.user_id,
        )
        period = MeterPeriod(
            year=self.year,
            month=self.month,
            day=self.day,
        )

        # `compute_meter_id` is the single source of truth for meter
        # identity. If a caller supplied a `meter_id`, validate it against
        # the canonical value; on mismatch, log a warning and overwrite
        # with the canonical ID so DAO upserts can never land under a
        # non-canonical PK. Mismatches are recoverable but loud.
        canonical = compute_meter_id(
            scope=scope,
            period=period,
            key=self.key,
        )

        if self.meter_id is not None and self.meter_id != canonical:
            log.warning(
                "[meters] supplied meter_id=%s does not match canonical=%s "
                "for scope/period/key — overwriting with canonical",
                self.meter_id,
                canonical,
            )

        self.meter_id = canonical

        return self

    def with_period(
        self,
        *,
        year: Optional[int],
        month: Optional[int],
        day: Optional[int],
    ) -> "MeterDTO":
        """Return a copy with the period normalized; recomputes meter_id."""

        data: dict[str, Any] = self.model_dump()
        data["year"] = year
        data["month"] = month
        data["day"] = day

        # Force re-computation of meter_id by clearing it.
        data["meter_id"] = None

        return MeterDTO(**data)
