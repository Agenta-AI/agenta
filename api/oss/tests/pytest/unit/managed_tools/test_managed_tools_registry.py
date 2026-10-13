"""The action definition's invariants and the registry's catalog checks."""

from typing import List

import pytest
from pydantic import BaseModel, ValidationError

from oss.src.core.managed_tools.dtos import (
    ManagedAction,
    ManagedActionBinding,
    ManagedActionPrice,
    ManagedActionResponse,
    ManagedActionUnit,
)
from oss.src.core.managed_tools.mock.actions import (
    ENRICH_PERSON,
    MOCK_ACTIONS,
    SEARCH_COMPANIES,
)
from oss.src.core.managed_tools.registry import ManagedActionRegistry
from oss.src.core.managed_tools.types import (
    ManagedActionNotFoundError,
    ManagedActionRegistryError,
)
from oss.tests.pytest.unit.managed_tools.fakes import FakeProvider


class _In(BaseModel):
    query: str


class _Out(BaseModel):
    items: List[int]
    total: int


def _action(**overrides) -> ManagedAction:
    values = dict(
        integration="acme",
        name="search",
        description="Search.",
        input_model=_In,
        output_model=_Out,
        binding=ManagedActionBinding(provider="acme_rest", operation="search"),
        unit=ManagedActionUnit.RESULTS,
        results_field="items",
    )
    values.update(overrides)
    return ManagedAction(**values)


def test_the_key_is_the_identity_and_the_tool_name_has_no_dot():
    assert ENRICH_PERSON.key == "mock.enrich_person"
    assert ENRICH_PERSON.tool == "mock_enrich_person"
    assert "." not in SEARCH_COMPANIES.tool


def test_a_per_result_action_must_count_a_list_field():
    with pytest.raises(ValidationError):
        _action(results_field=None)
    with pytest.raises(ValidationError):
        _action(results_field="total")
    with pytest.raises(ValidationError):
        _action(results_field="missing")
    with pytest.raises(ValidationError):
        _action(unit=ManagedActionUnit.CALLS)


def test_a_fixed_argument_cannot_also_be_an_input_field():
    with pytest.raises(ValidationError):
        _action(
            binding=ManagedActionBinding(
                provider="acme_rest", operation="search", fixed_arguments={"query": "x"}
            )
        )


def test_a_per_result_price_needs_a_cap_and_the_worst_case_uses_it():
    with pytest.raises(ValidationError):
        ManagedActionPrice(unit=ManagedActionUnit.RESULTS, musd_per_unit=10)
    capped = ManagedActionPrice(
        unit=ManagedActionUnit.RESULTS, musd_per_unit=2_000, max_units_per_call=10
    )
    per_call = ManagedActionPrice(unit=ManagedActionUnit.CALLS, musd_per_unit=20_000)
    assert capped.worst_case_musd == 20_000
    assert per_call.worst_case_musd == 20_000


def test_a_response_carries_exactly_one_ending():
    with pytest.raises(ValidationError):
        ManagedActionResponse()
    with pytest.raises(ValidationError):
        ManagedActionResponse(output={}, failure={"kind": "rejected", "message": "no"})


def test_the_registry_refuses_an_action_bound_to_an_unregistered_provider():
    with pytest.raises(ManagedActionRegistryError):
        ManagedActionRegistry(actions=[_action()], providers=[])


def test_the_registry_refuses_duplicates():
    provider = FakeProvider("acme_rest")
    with pytest.raises(ManagedActionRegistryError):
        ManagedActionRegistry(actions=[_action(), _action()], providers=[provider])
    with pytest.raises(ManagedActionRegistryError):
        ManagedActionRegistry(
            actions=[], providers=[provider, FakeProvider("acme_rest")]
        )


def test_the_registry_looks_actions_up_by_tool_name_only():
    registry = ManagedActionRegistry(
        actions=MOCK_ACTIONS,
        providers=[FakeProvider("mock_rest"), FakeProvider("mock_mcp")],
    )

    assert registry.get_by_tool("mock_search_companies") is SEARCH_COMPANIES
    assert registry.provider_for(SEARCH_COMPANIES).name == "mock_mcp"
    assert [action.key for action in registry.list()] == [
        "mock.enrich_person",
        "mock.search_companies",
    ]
    with pytest.raises(ManagedActionNotFoundError):
        registry.get_by_tool("mock.search_companies")


def test_the_mock_actions_use_two_transports_and_two_price_shapes():
    assert {action.binding.provider for action in MOCK_ACTIONS} == {
        "mock_rest",
        "mock_mcp",
    }
    assert {action.unit for action in MOCK_ACTIONS} == {
        ManagedActionUnit.CALLS,
        ManagedActionUnit.RESULTS,
    }
    # The count argument is bounded, so the upstream's own cost is too.
    limit = SEARCH_COMPANIES.input_model.model_json_schema()["properties"]["limit"]
    assert limit["maximum"] == 25
    # The cost-raising flag is fixed, and invisible to the model.
    assert ENRICH_PERSON.binding.fixed_arguments == {"reveal_phone_number": False}
    assert "reveal_phone_number" not in str(
        ENRICH_PERSON.input_model.model_json_schema()
    )
