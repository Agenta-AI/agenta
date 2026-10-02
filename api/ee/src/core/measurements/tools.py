"""The wallet's side of managed tool actions: the price list, worst-case admission, and one
`MeasurementCommandV1` per dispatched execution on `streams:measurements`."""

from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import UUID

from oss.src.core.managed_tools.dtos import (
    ManagedAction,
    ManagedActionMeasurement,
    ManagedActionPrice,
    ManagedActionUnit,
)
from oss.src.core.managed_tools.interfaces import ManagedActionBillingInterface

from ee.src.core.measurements.components import ACTION_CALLS, ACTION_RESULTS
from ee.src.core.measurements.rate_card import ACTION_RATES, action_rates_for
from ee.src.core.wallets.admission import admit_in_mode, measured
from ee.src.core.wallets.contracts import (
    GatewayKind,
    MeasurementCommandV1,
    MeasurementComponentV1,
)
from ee.src.core.wallets.service import WalletsService
from ee.src.core.wallets.streaming import MeasurementPublisher

# Platform-paid, as a `builtin` gateway call is: every managed provider spends Agenta's
# own account.
ACTION_ENDPOINT_KIND = "builtin"

UNIT_COMPONENTS: Dict[ManagedActionUnit, str] = {
    ManagedActionUnit.CALLS: ACTION_CALLS,
    ManagedActionUnit.RESULTS: ACTION_RESULTS,
}
_COMPONENT_UNITS = {key: unit for unit, key in UNIT_COMPONENTS.items()}


def unit_of_component(key: str) -> Optional[str]:
    """The unit name ("calls", "results") a measurement component key counts."""
    unit = _COMPONENT_UNITS.get(key)
    return unit.value if unit else None


class ManagedActionUnpricedError(Exception):
    def __init__(self, action: str):
        self.action = action
        super().__init__(f"Managed action {action!r} has no price.")


def action_price(action: str) -> Optional[ManagedActionPrice]:
    rates = action_rates_for(action=action)
    if rates is None:
        return None
    return ManagedActionPrice(
        unit=_COMPONENT_UNITS[rates.unit],
        musd_per_unit=rates.musd_per_unit,
        max_units_per_call=rates.max_units_per_call,
    )


class WalletManagedActionBilling(ManagedActionBillingInterface):
    def __init__(self, *, wallet: WalletsService, publisher: MeasurementPublisher):
        self.wallet = wallet
        self.publisher = publisher

    async def prices(self) -> Dict[str, ManagedActionPrice]:
        return {action: action_price(action) for action in ACTION_RATES}

    async def admit(self, *, organization_id: UUID, action: ManagedAction) -> bool:
        price = action_price(action.key)
        # An unpriced action would be charged nothing, or dead-lettered: never run it.
        if price is None or price.unit != action.unit:
            raise ManagedActionUnpricedError(action.key)
        return await admit_in_mode(
            organization_id=organization_id,
            point="managed_tool",
            check=lambda: self.wallet.covers(
                organization_id=organization_id, amount_musd=price.worst_case_musd
            ),
        )

    async def record(self, *, measurement: ManagedActionMeasurement) -> None:
        if not await measured(measurement.context.organization_id):
            return
        # A refused publish is logged by the publisher; the executor contains the rest.
        await self.publisher.publish(action_measurement(measurement))


def action_measurement(measurement: ManagedActionMeasurement) -> MeasurementCommandV1:
    """Deterministic in the execution: the execution id is the measurement id, so a
    redelivered message is stored and charged once."""
    context = measurement.context
    unit_key = UNIT_COMPONENTS[measurement.unit]
    execution: Dict[str, Any] = {
        "id": measurement.execution_id,
        "outcome": measurement.outcome.value,
    }
    if measurement.provider_reference:
        execution["provider_reference"] = measurement.provider_reference
    if measurement.provider_cost:
        execution["provider_cost"] = measurement.provider_cost.model_dump()
    references: Dict[str, Any] = {"execution": execution}
    if context.run_id:
        references["workflow"] = {"gateway_run_id": context.run_id}
    if context.session_id:
        references["session"] = {"id": context.session_id}
    return MeasurementCommandV1(
        measurement_id=measurement.execution_id,
        organization_id=context.organization_id,
        project_id=context.project_id,
        user_id=context.user_id,
        agent_id=_uuid_or_none(context.agent_id),
        gateway_kind=GatewayKind.TOOL,
        request_id=measurement.execution_id,
        resource_key=f"{GatewayKind.TOOL.value}:{measurement.action}",
        resource_locator={
            "action": measurement.action,
            "provider": measurement.provider,
            "unit": unit_key,
        },
        endpoint_kind=ACTION_ENDPOINT_KIND,
        start_time=measurement.start_time,
        end_time=measurement.end_time,
        components=[MeasurementComponentV1(key=unit_key, value=measurement.units)],
        references=references,
        created_at=datetime.now(timezone.utc),
    )


def _uuid_or_none(value: Optional[str]) -> Optional[UUID]:
    try:
        return UUID(value) if value else None
    except ValueError:
        return None
