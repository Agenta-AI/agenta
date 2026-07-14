"""The ``/run`` wire models are the single schema source of truth.

These tests prove the dedicated Pydantic wire models in ``agenta.sdk.agents.wire_models``
faithfully describe the wire that ``request_to_wire`` / ``result_from_wire`` (in ``utils/wire.py``)
produce and parse, and that the exported JSON Schema is the one shipped in the SDK through
``CATALOG_TYPES``.

This is the Python-side guard the project plan calls for:

- The exported schema is committed into the SDK (``CATALOG_TYPES['run_request' | 'run_result']``)
  and a freshness test asserts the catalog entry equals a fresh export, so the schema cannot
  silently drift from the models.
- The golden fixtures (the cross-language anchor) validate against the exported schema — an
  "example must validate" check that proves the schema describes today's wire.
- ``request_to_wire`` output validates against the schema, so the producer and the schema agree.
- The request schema's property set equals the hand-kept ``KNOWN_REQUEST_KEYS`` in
  ``test_wire_contract.py``, so a new wire field cannot land in one place and not the other.

There is NO runtime validation in this phase (per the project plan): nothing here gates a live
``/run``. These models are an SDK-side schema artifact and a test guard only.
"""

from __future__ import annotations

import jsonschema
import pytest

from agenta.sdk.agents.wire_models import (
    WireRunRequest,
    WireRunResult,
    run_contract_schemas,
)
from agenta.sdk.utils.types import CATALOG_TYPES

from .test_wire_contract import (
    KNOWN_REQUEST_KEYS,
    _agenta_payload,
    _claude_payload,
    _pi_payload,
)


def test_run_contract_ships_in_the_sdk_catalog():
    # The exported JSON interface lives in the SDK alongside the other catalog types, so a
    # client / the playground / `/inspect` can resolve it the same way as `agent-template`.
    assert "run_request" in CATALOG_TYPES
    assert "run_result" in CATALOG_TYPES
    assert CATALOG_TYPES["run_request"]["x-ag-type"] == "run_request"
    assert CATALOG_TYPES["run_result"]["x-ag-type"] == "run_result"


def test_committed_catalog_matches_a_fresh_export():
    # Freshness: regenerate the schema in-memory and assert the committed catalog entry equals
    # it (drift -> fail), the same discipline the goldens already use. If the wire models change,
    # this fails until the export is regenerated.
    fresh = run_contract_schemas()
    assert CATALOG_TYPES["run_request"] == fresh["run_request"]
    assert CATALOG_TYPES["run_result"] == fresh["run_result"]


def test_exported_schema_is_dereferenced_and_camelcase():
    # The exported schema is self-contained (no `$defs`/`$ref`, like every catalog entry) and
    # speaks the camelCase wire keys, not the snake_case Python field names.
    req = CATALOG_TYPES["run_request"]
    assert "$defs" not in req
    props = req["properties"]
    assert "sessionId" in props and "session_id" not in props
    assert "customTools" in props and "custom_tools" not in props


def test_request_schema_properties_equal_known_request_keys():
    # The schema-derived property set is exactly the hand-kept guard in `test_wire_contract.py`.
    # This is the schema-derived key guard: a new wire field cannot be added to one without the
    # other, so the two cannot silently fall out of step.
    assert set(CATALOG_TYPES["run_request"]["properties"]) == KNOWN_REQUEST_KEYS


@pytest.mark.parametrize(
    "golden_name, model",
    [
        ("run_request.pi_core.json", WireRunRequest),
        ("run_request.claude.json", WireRunRequest),
        ("run_result.ok.json", WireRunResult),
        ("run_result.error.json", WireRunResult),
    ],
)
def test_goldens_parse_into_the_wire_models(golden, golden_name, model):
    # Every golden parses cleanly into its wire model (by camelCase alias), proving the models
    # accept the real wire. The ok-result golden includes a deliberately typeless event; the
    # open `WireEvent` (type optional) tolerates it, mirroring the parser's drop behavior.
    model.model_validate(golden(golden_name))


@pytest.mark.parametrize(
    "golden_name, ag_type",
    [
        ("run_request.pi_core.json", "run_request"),
        ("run_request.claude.json", "run_request"),
        ("run_result.ok.json", "run_result"),
        ("run_result.error.json", "run_result"),
    ],
)
def test_goldens_validate_against_the_exported_schema(golden, golden_name, ag_type):
    # "Examples must validate": each golden validates against the exported JSON Schema shipped in
    # the SDK. This proves the schema describes today's wire. It is a TEST, not a runtime guard.
    jsonschema.validate(golden(golden_name), CATALOG_TYPES[ag_type])


def test_request_to_wire_output_validates_against_the_schema():
    # The producer and the schema agree: the dict `request_to_wire` builds for each harness
    # validates against the exported request schema and round-trips through the wire model.
    for payload in (_pi_payload(), _claude_payload(), _agenta_payload()):
        jsonschema.validate(payload, CATALOG_TYPES["run_request"])
        WireRunRequest.model_validate(payload)


def test_minimal_result_validates():
    # A bare success result (the `result_from_wire` minimal case) is valid against the schema.
    payload = {"ok": True}
    jsonschema.validate(payload, CATALOG_TYPES["run_result"])
    assert WireRunResult.model_validate(payload).ok is True
