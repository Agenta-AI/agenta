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

from agenta.sdk.engines.running.utils import retrieve_handler, retrieve_interface

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
    # A second build in the same process must not break the binding (the handler register is a
    # setdefault, the interface override is idempotent). The acceptance criteria still hold.
    app.create_agent_app()
    assert retrieve_handler(_AGENT_URI) is not None
    interface = retrieve_interface(_AGENT_URI)
    assert interface is not None and interface.uri == _AGENT_URI
