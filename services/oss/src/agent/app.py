"""Agent workflow app: composition + mount over the SDK's `agent_v0` handler.

Mirrors the chat/completion services: an Agenta app exposing ``/invoke`` and ``/inspect``
through ``ag.create_app`` + ``ag.workflow`` + ``ag.route``. Supplies service-specific
composition (on-file template default, sandbox-agent backend selection, MCP gate) over
``agenta.sdk.agents.handler.AgentComposition``, which owns the stream/batch/fold/trim/force
contract AND the capability-gating / degradation-policy / run_kind orchestration (this
used to be re-implemented here; the service now builds one composition and delegates).

The sandbox-agent-backed backend is the production path. The transport is a deployment
choice: HTTP to `AGENTA_RUNNER_INTERNAL_URL`, or a local runner CLI in a source checkout.
The harness, sandbox, and permission policy are editable fields on the agent config.
"""

from typing import Any, Dict, List, Optional

import agenta as ag

from agenta.sdk.agents import (
    AgentTemplate,
    Backend,
    LocalSandboxNotAllowedError,
    SandboxAgentBackend,
)

from agenta.sdk.agents.handler import (
    AgentComposition,
    make_agent_handler,
)
from agenta.sdk.agents.platform import resolve_connection

from agenta.sdk.decorators.tracing import auto_instrument
from agenta.sdk.engines.running.utils import (
    register_handler,
    register_interface,
)
from agenta.sdk.models.workflows import (
    WorkflowRevisionData,
    WorkflowServiceRequest,
)

from agenta.sdk.utils.logging import get_module_logger

from agenta.sdk.agents.tracing import record_usage, run_context, trace_context

from oss.src.agent.config import (
    load_config,
    runner_dir,
    runner_url,
    sandbox_local_allowed,
)
from oss.src.agent.schemas import AGENT_SCHEMAS
from oss.src.agent.tools import resolve_mcp_servers, resolve_tools

log = get_module_logger(__name__)


def _default_agent_template() -> AgentTemplate:
    """The service's file defaults (AGENTS.md, model, tools) as a neutral AgentTemplate."""
    file_cfg = load_config()
    return AgentTemplate(
        instructions=file_cfg.agents_md,
        model=file_cfg.model,
        tools=file_cfg.tools,
    )


def select_backend(agent_template: AgentTemplate) -> Backend:
    """Pick the backend for a run from the agent config's run-selection fields.

    The service always uses the sandbox-agent-backed runner. `AGENTA_RUNNER_INTERNAL_URL`
    selects HTTP transport in deployed containers. When it is unset, local development
    spawns the TypeScript runner CLI from the runner dir. Only ``sandbox`` is read here;
    it is a backend/environment concern that never enters ``SessionConfig``.

    ``local`` is refused unless ``AGENTA_SANDBOX_LOCAL_ALLOWED`` is on: it is unconfined
    host bash, not a tenant boundary, on a shared deployment. This is the producer-side
    gate; the runner's own id whitelist is a second, independent layer.
    """
    if agent_template.sandbox == "local" and not sandbox_local_allowed():
        raise LocalSandboxNotAllowedError()
    return SandboxAgentBackend(
        sandbox=agent_template.sandbox,
        url=runner_url(),
        cwd=str(runner_dir()),
    )


def _composition() -> AgentComposition:
    """Build the service's `AgentComposition` from the current (patchable) module names.

    Built fresh per call so `monkeypatch.setattr(app, "resolve_tools", ...)`-style test
    patches on this module keep working exactly as before the seam was unified: every
    field below is a live lookup of a module-level name, not a value captured at import time.
    """
    return AgentComposition(
        default_template=_default_agent_template,
        resolve_tools=resolve_tools,
        resolve_mcp_servers=resolve_mcp_servers,
        resolve_connection=resolve_connection,
        select_backend=select_backend,
        trace_context=trace_context,
        run_context=run_context,
        record_usage=record_usage,
    )


async def _agent(
    request: WorkflowServiceRequest,
    inputs: Optional[Dict[str, Any]] = None,
    messages: Optional[List[Any]] = None,
    parameters: Optional[Dict] = None,
):
    """Service entrypoint: delegate to the SDK seam with the service's composition.

    A fresh handler is built per call (cheap: composition is dataclass field assignment) so
    the module-level names above stay the patch points every existing test uses.
    """
    handler = make_agent_handler(_composition())
    return await handler(
        request=request, inputs=inputs, messages=messages, parameters=parameters
    )


AGENT_URI = "agenta:builtin:agent:v0"


def create_agent_app():
    app = ag.create_app()
    # Bind the live `_agent` handler to the builtin URI `agenta:builtin:agent:v0` (issue 2: one
    # canonical identity for the agent workflow). The SDK seeds the registries for this URI with a
    # minimal default interface; the service is the authoritative live owner in its own process, so:
    #
    # 1. Instrument `_agent`, then register THAT under the builtin URI, REPLACING the SDK-seeded
    #    composition-default `agent_v0` (register_handler replaces, like register_interface).
    #    Order matters: `ag.workflow` only instruments inside `_register_handler`, which it skips
    #    once a handler exists in the registry. Registering the raw `_agent` would lose tracing
    #    instrumentation; registering the instrumented one keeps it (mirrors chat.py).
    # 2. REPLACE the interface registry entry with the service interface (AGENT_SCHEMAS), so
    #    `retrieve_interface(AGENT_URI)` returns the SAME schemas `/inspect` advertises.
    # 3. Build the workflow against the URI. `ag.workflow.__init__` resolves the (instrumented)
    #    handler and merges the registered interface; the passed `schemas` still win.
    #
    # `/inspect` carries NO behavior-changing `meta`: it must not differ for agent vs non-agent.
    # Harness connection capabilities live in the `harnesses` catalog
    # (`GET /catalog/harnesses/{ag_harness}`, built from the SDK's `harness_catalog_document`) and
    # are resolved by the frontend via `x-ag-harness-ref` on the agent-config harness field — the
    # same catalog/ref mechanism as every other type. The agent service still imports the SDK
    # capability table directly for its server-side reject; it never publishes it on inspect.
    register_handler(
        auto_instrument(_agent),
        uri=AGENT_URI,
    )
    register_interface(
        WorkflowRevisionData(uri=AGENT_URI, schemas=AGENT_SCHEMAS),
        uri=AGENT_URI,
    )
    routed = ag.workflow(uri=AGENT_URI, schemas=AGENT_SCHEMAS)(_agent)
    ag.route("/", app=app, flags={"is_chat": True})(routed)
    return app


agent_v0_app = create_agent_app()
