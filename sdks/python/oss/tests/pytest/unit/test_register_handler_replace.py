"""`register_handler` ownership semantics: setdefault by default, overwrite with `replace=True`.

Regression pin for the sessions-persist 401 / trace_id=None bug: the SDK statically seeds
`agenta:builtin:agent:v0` in `HANDLER_REGISTRY` with its bare `agent_v0` (noop trace/run
context, uninstrumented). The agent service re-registers its composed + instrumented handler
under the same URI at startup — but `register_handler` was pure `setdefault`, so that
registration was a SILENT no-op: the bare seed kept running, the run request carried no
telemetry credential (runner logged `cred=MISSING`, every runner->API session call 401'd,
persisted events were DROPPED) and `/invoke` responses returned `trace_id=None`.

The fix gives `register_handler` an explicit `replace=True` for a process that owns a URI.
These tests pin both semantics against the real registry (entries are restored afterwards).
"""

import pytest

from agenta.sdk.engines.running.utils import (
    HANDLER_REGISTRY,
    register_handler,
    retrieve_handler,
)

AGENT_URI = "agenta:builtin:agent:v0"


@pytest.fixture()
def restore_registry():
    """Snapshot the touched registry buckets and restore them after the test."""
    saved_agent = HANDLER_REGISTRY["agenta"]["builtin"].get("agent", {}).copy()
    saved_custom = (
        HANDLER_REGISTRY.get("user", {})
        .get("custom", {})
        .get("reg_replace_probe", {})
        .copy()
    )
    yield
    HANDLER_REGISTRY["agenta"]["builtin"]["agent"] = saved_agent
    user_custom = HANDLER_REGISTRY.setdefault("user", {}).setdefault("custom", {})
    if saved_custom:
        user_custom["reg_replace_probe"] = saved_custom
    else:
        user_custom.pop("reg_replace_probe", None)


def _first():
    return "first"


def _second():
    return "second"


class TestRegisterHandlerDefaultKeepsExisting:
    def test_second_registration_is_a_noop(self, restore_registry):
        uri = "user:custom:reg_replace_probe:v1"
        register_handler(_first, uri=uri)
        register_handler(_second, uri=uri)
        assert retrieve_handler(uri) is _first


class TestRegisterHandlerReplaceTakesOwnership:
    def test_replace_overwrites_existing(self, restore_registry):
        uri = "user:custom:reg_replace_probe:v2"
        register_handler(_first, uri=uri)
        register_handler(_second, uri=uri, replace=True)
        assert retrieve_handler(uri) is _second

    def test_replace_overrides_the_seeded_builtin_agent(self, restore_registry):
        """The exact production shape: the statically seeded `agent.v0` must yield to a
        service that registers its own composed handler with `replace=True`."""
        seeded = retrieve_handler(AGENT_URI)
        assert seeded is not None  # the SDK seed exists (the shadowing hazard is real)

        def service_agent():
            return "service"

        register_handler(service_agent, uri=AGENT_URI, replace=True)
        assert retrieve_handler(AGENT_URI) is service_agent

    def test_replace_on_empty_slot_registers_normally(self, restore_registry):
        uri = "user:custom:reg_replace_probe:v3"
        register_handler(_first, uri=uri, replace=True)
        assert retrieve_handler(uri) is _first
