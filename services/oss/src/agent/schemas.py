"""JSON schemas the agent workflow advertises via ``/inspect``.

The agent self-describes its interface here instead of registering a static SDK
interface. The shape mirrors the chat workflow (messages in, a single assistant
message out) so the playground renders a chat box and POSTs `data.inputs.messages`.

Kept in its own module so it composes into the workflow registration with a one-line
change and stays out of the handler logic.
"""

_SCHEMA = "https://json-schema.org/draft/2020-12/schema"

# Default config the playground pre-fills and the agent falls back to. Kept in sync
# with the catalog template and ``config.py`` (DEFAULT_MODEL / DEFAULT_AGENTS_MD).
_DEFAULT_MODEL = "gpt-5.5"
_DEFAULT_AGENTS_MD = (
    "You are a friendly hello-world agent running on the Agenta agent service.\n\n"
    "- Greet the user warmly.\n"
    "- Answer the user's message in one or two short sentences."
)

# Inputs: a chat-style message list. `x-ag-type-ref: messages` is what marks the
# workflow as chat to the playground (same marker the builtin chat service uses).
AGENT_INPUTS_SCHEMA = {
    "$schema": _SCHEMA,
    "type": "object",
    "additionalProperties": True,
    "properties": {
        "messages": {
            "x-ag-type-ref": "messages",
            "type": "array",
            "description": "Ordered list of normalized chat messages.",
        },
    },
}

# The agent config element: one composite control the playground renders for the whole
# agent config, instead of reusing `prompt-template` plus loose params. The field shape is
# the `agent_config` catalog type (AgentConfigSchema in agenta.sdk.utils.types), so this is a
# thin `x-ag-type-ref` the playground resolves against `/workflows/catalog/types/agent_config`
# and dispatches to the AgentConfigControl (web/packages/agenta-entity-ui/.../AgentConfigControl.tsx).
# The catalog type keeps the typed tools/mcp_servers shape in one place; this schema only
# carries the default that the playground pre-fills. The agent handler reads it from
# `parameters.agent` in app.py.
# Reserved slug of the platform default skill, served from code by the PlatformWorkflowCatalog
# (api/oss/src/core/workflows/platform_catalog.py), never the database. The default config
# references it by stable slug through an @ag.embed; the embed resolver inlines the catalogue's
# SkillConfig (at the canonical parameters.skill selector) before the runner sees it. The
# `_agenta.` prefix is reserved: a user cannot author or shadow it. This replaces both
# AGENTA_FORCED_SKILLS and the old per-project skill seeder.
_DEFAULT_SKILL_SLUG = "_agenta.agenta-getting-started"

_DEFAULT_AGENT_CONFIG = {
    "agents_md": _DEFAULT_AGENTS_MD,
    "model": _DEFAULT_MODEL,
    "tools": [],
    "mcp_servers": [],
    "harness": "pi",
    "sandbox": "local",
    "permission_policy": "auto",
    # The declared sandbox boundary the playground pre-fills (Layer 2). Network egress on by
    # default; the runner does not enforce it yet (plumbing-only slice).
    "sandbox_permission": {
        "network": {"mode": "on", "allowlist": []},
        "enforcement": "strict",
    },
    "skills": [
        {
            "@ag.embed": {
                # Reference the skill at the ARTIFACT level (resolves to its latest revision).
                # A `workflow_revision` slug matches the revision's own hash slug, not the
                # author-facing artifact slug, so a bare revision slug with no version 500s;
                # `workflow.slug` is the correct "use the latest" shape. Pin a version with
                # `{"workflow_revision": {"slug": <artifact-slug>, "version": "v3"}}`.
                "@ag.references": {"workflow": {"slug": _DEFAULT_SKILL_SLUG}},
                "@ag.selector": {"path": "parameters.skill"},
            }
        }
    ],
}

AGENT_CONFIG_SCHEMA = {
    "type": "object",
    "x-ag-type-ref": "agent_config",
    "title": "Agent",
    "description": "The agent's instructions, model, tools, MCP servers, and runtime.",
    "default": _DEFAULT_AGENT_CONFIG,
}

AGENT_PARAMETERS_SCHEMA = {
    "$schema": _SCHEMA,
    "type": "object",
    "additionalProperties": True,
    "properties": {"agent": AGENT_CONFIG_SCHEMA},
}

# Outputs: the final assistant message.
AGENT_OUTPUTS_SCHEMA = {
    "$schema": _SCHEMA,
    "x-ag-type-ref": "message",
    "type": "object",
    "description": "Final assistant message returned by the agent.",
}

AGENT_SCHEMAS = {
    "inputs": AGENT_INPUTS_SCHEMA,
    "parameters": AGENT_PARAMETERS_SCHEMA,
    "outputs": AGENT_OUTPUTS_SCHEMA,
}
