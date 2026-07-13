"""Issue 2: the agent builtin URI is bound to the live handler + interface.

`create_agent_app()` registers the live `_agent` handler under `agenta:builtin:agent:v0` and
overrides the interface registry with the service interface, so the builtin URI and the live
service identity are one. These tests are the acceptance criteria from
`docs/design/agent-workflows/interfaces/architecture-followups.md` issue 2:

- `retrieve_handler("agenta:builtin:agent:v0")` returns the live handler (not None).
- `retrieve_interface("agenta:builtin:agent:v0")` returns the same schemas `/inspect` advertises
  (the service `AGENT_SCHEMAS`), not the SDK's minimal builtin interface.

Importing `oss.src.agent.app` builds the app (module-level `create_agent_app()`), which performs
the binding, so the registries are populated by the time these tests run.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents.capabilities import harness_catalog_document
from agenta.sdk.decorators.routing import _to_inspect_response
from agenta.sdk.decorators.running import inspect_workflow
from agenta.sdk.engines.running.utils import (
    retrieve_handler,
    retrieve_interface,
)
from agenta.sdk.models.workflows import WorkflowInspectRequest

from oss.src.agent import app
from oss.src.agent.schemas import AGENT_SCHEMAS

_AGENT_URI = "agenta:builtin:agent:v0"


def test_retrieve_handler_returns_the_live_handler():
    handler = retrieve_handler(_AGENT_URI)
    assert handler is not None
    assert callable(handler)


def test_bound_handler_is_instrumented_not_the_raw_agent():
    # The handler registered under the URI is the auto-instrumented `_agent`, not the raw function:
    # `ag.workflow` only instruments inside `_register_handler`, which it skips once a handler
    # exists in the registry, so the service must register the instrumented one itself.
    handler = retrieve_handler(_AGENT_URI)
    assert handler is not app._agent


def test_retrieve_interface_matches_what_inspect_advertises():
    # The interface bound under the builtin URI carries the SAME schemas `/inspect` advertises
    # (the service `AGENT_SCHEMAS`), not the SDK's minimal builtin interface. One identity, one
    # interface, so the inspect path and the catalog/invoke path agree.
    interface = retrieve_interface(_AGENT_URI)
    assert interface is not None
    assert interface.uri == _AGENT_URI
    assert interface.schemas is not None
    assert interface.schemas.inputs == AGENT_SCHEMAS["inputs"]
    assert interface.schemas.parameters == AGENT_SCHEMAS["parameters"]
    assert interface.schemas.outputs == AGENT_SCHEMAS["outputs"]


def test_rebuilding_the_app_keeps_the_binding_stable():
    # A second build in the same process must not break the binding (the handler register
    # REPLACES, like the interface override, so a rebuild is idempotent).
    app.create_agent_app()
    assert retrieve_handler(_AGENT_URI) is not None
    interface = retrieve_interface(_AGENT_URI)
    assert interface is not None and interface.uri == _AGENT_URI


def test_harness_capabilities_live_in_the_catalog_not_inspect_meta():
    # Harness capabilities are NOT published on inspect meta (inspect must not behave differently
    # for agent vs non-agent). They live in the `harnesses` catalog, keyed by harness, with
    # `capabilities` as a field. The frontend resolves them via `x-ag-harness-ref`.
    doc = harness_catalog_document()
    assert set(doc) == {"pi_core", "pi_agenta", "claude"}
    # Each record is {harness, capabilities: {...}}; claude reaches anthropic, Pi per-provider.
    assert doc["claude"]["harness"] == "claude"
    assert doc["claude"]["capabilities"]["models"]["anthropic"]
    assert doc["pi_core"]["capabilities"]["models"]["openai"]


@pytest.mark.asyncio
async def test_request_driven_inspect_carries_no_harness_meta():
    # The playground posts `/inspect` with a `revision`, taking the request-driven
    # `inspect_workflow` branch. The agent no longer injects any harness meta, so the normalized
    # response carries none — inspect is uniform across workflows.
    built = await inspect_workflow(
        request=WorkflowInspectRequest(revision={"uri": _AGENT_URI})
    )
    response = _to_inspect_response(built)

    assert not (response.meta and "harness_capabilities" in response.meta)
