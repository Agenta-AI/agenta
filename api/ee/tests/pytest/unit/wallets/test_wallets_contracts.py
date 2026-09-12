import pytest
from pydantic import ValidationError

from ee.src.core.wallets.contracts import DebitCommandV1, MeasurementCommandV1
from ee.tests.pytest.utils.wallets.builders import (
    build_debit_command,
    build_llm_component,
    build_mcp_component,
    build_measurement_command,
    build_sbx_component,
)


def test_measurement_command_accepts_none_organization_id():
    command = build_measurement_command(organization_id=None)
    assert command.organization_id is None


def test_measurement_command_requires_project_id():
    payload = build_measurement_command().model_dump(mode="json")
    payload.pop("project_id")

    with pytest.raises(ValidationError):
        MeasurementCommandV1(**payload)


def test_debit_command_requires_organization_id():
    payload = build_debit_command().model_dump(mode="json")
    payload.pop("organization_id")

    with pytest.raises(ValidationError):
        DebitCommandV1(**payload)


@pytest.mark.parametrize("amount_musd", [0, -1, -1020])
def test_debit_command_rejects_non_positive_amount(amount_musd):
    with pytest.raises(ValidationError):
        build_debit_command(amount_musd=amount_musd)


def test_debit_command_accepts_strictly_positive_amount():
    command = build_debit_command(amount_musd=1)
    assert command.amount_musd == 1


def test_llm_component_builder():
    component = build_llm_component()
    assert component.key == "input_tokens"
    assert isinstance(component.value, int)
    assert component.cost_musd is not None


def test_mcp_component_builder():
    component = build_mcp_component()
    assert component.key == "request_count"
    assert isinstance(component.value, int)


def test_sbx_component_builder():
    component = build_sbx_component()
    assert component.key == "vcpu_core_time_msec"
    assert isinstance(component.value, int)


def test_debit_command_has_no_provider_metrics_or_measurement_reference():
    """The debit command is the boundary that keeps the wallet domain-agnostic: no
    measurement id, no metric values, no provider cost, no request id, no workflow
    references. Assert over the model's field names so this stays true as the envelope
    evolves."""
    forbidden_fields = {
        "measurement_id",
        "request_id",
        "components",
        "provider_cost_musd",
        "cost_musd",
        "references",
        "workflow",
        "workflow_id",
        "gateway_kind",
        "endpoint_id",
        "endpoint_kind",
        "start_time",
        "end_time",
    }
    actual_fields = set(DebitCommandV1.model_fields.keys())
    assert actual_fields.isdisjoint(forbidden_fields)

    expected_fields = {
        "version",
        "idempotency_key",
        "organization_id",
        "debit_kind",
        "amount_musd",
        "pricing_version",
        "resource_key",
        "resource_locator",
        "created_at",
    }
    assert actual_fields == expected_fields
