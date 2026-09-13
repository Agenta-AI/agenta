"""Explicit wire-DTO <-> DB-row mapping for measurements.

The wire component model is `MeasurementComponentV1`; the table is
`measurement_values`. That name divergence (wire DTO vs DB row) is intentional —
this module is the one place the correspondence is made explicit, rather than
left implicit in DAO insert calls.
"""

from typing import Any, Dict, List
from uuid import UUID

from ee.src.core.wallets.contracts import MeasurementCommandV1, MeasurementComponentV1


def measurement_command_to_row(
    *,
    measurement_row_id: UUID,
    command: MeasurementCommandV1,
) -> Dict[str, Any]:
    """One `measurements` row's column values for `command`.

    `measurement_row_id` is the generated primary key (`measurements.id`); the
    gateway-minted `command.measurement_id` is the separate, unique business key.
    """
    return {
        "id": measurement_row_id,
        "measurement_id": command.measurement_id,
        "project_id": command.project_id,
        "user_id": command.user_id,
        "agent_id": command.agent_id,
        "gateway_kind": command.gateway_kind.value,
        "request_id": command.request_id,
        "resource_key": command.resource_key,
        "endpoint_id": command.endpoint_id,
        "endpoint_kind": command.endpoint_kind,
        "resource_locator": command.resource_locator,
        "data": {"references": command.references},
        "start_time": command.start_time,
        "end_time": command.end_time,
    }


def measurement_component_to_row(
    *,
    measurement_row_id: UUID,
    component: MeasurementComponentV1,
) -> Dict[str, Any]:
    """One `measurement_values` row for one `MeasurementComponentV1` — the
    explicit component -> row correspondence: `key`/`value`/`cost_musd` map
    1:1, and `measurement_row_id` is the generated (not business) parent id."""
    return {
        "measurement_id": measurement_row_id,
        "key": component.key,
        "value": component.value,
        "cost_musd": component.cost_musd,
    }


def measurement_components_to_rows(
    *,
    measurement_row_id: UUID,
    components: List[MeasurementComponentV1],
) -> List[Dict[str, Any]]:
    return [
        measurement_component_to_row(
            measurement_row_id=measurement_row_id, component=component
        )
        for component in components
    ]
