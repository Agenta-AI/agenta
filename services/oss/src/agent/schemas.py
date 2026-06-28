"""JSON schemas the agent workflow advertises via ``/inspect``.

The agent self-describes its interface here instead of registering a static SDK
interface. The shape mirrors the chat workflow (messages in, a message list out)
so the playground renders a chat box and POSTs `data.inputs.messages`.

Kept in its own module so it composes into the workflow registration with a one-line
change and stays out of the handler logic.
"""

from agenta.sdk.agents.adapters.agenta_builtins import GETTING_STARTED_WITH_AGENTA_SLUG
from agenta.sdk.utils.types import build_agent_v0_default

_SCHEMA = "https://json-schema.org/draft/2020-12/schema"

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

# The agent template is one object at `parameters.agent` (just as the chat workflow's prompt template
# is one object at `parameters.prompt`): the `agent-template` catalog type, with the portable
# definition (instructions/llm/tools/mcps/skills) flat on it and the execution parts (harness/runner/
# sandbox) as nested sub-objects. So `parameters.agent` carries the `x-ag-type-ref: agent-template`
# the playground resolves against `/workflows/catalog/types/agent-template` and dispatches to the one
# composite AgentTemplateControl (web/packages/agenta-entity-ui/.../AgentTemplateControl.tsx). The
# catalog type keeps the typed tools/mcps shape in one place; this schema only carries the default the
# playground pre-fills. The agent handler passes `parameters` verbatim to `AgentTemplate.from_params`,
# which reads the template at `parameters.agent` (so a tool is at `parameters.agent.tools`).
# Reserved slug of the static default skill, served from code by the StaticWorkflowCatalog
# (api/oss/src/core/workflows/static_catalog.py), never the database. The default config
# references it by stable slug through an @ag.embed; the embed resolver inlines the catalogue's
# SkillTemplate (at the canonical parameters.skill selector) before the runner sees it. The
# `__ag__` prefix is reserved: a user cannot author or shadow it. This replaces both
# AGENTA_FORCED_SKILLS and the old per-project skill seeder. Single source: the SDK constant.
_DEFAULT_SKILL_SLUG = GETTING_STARTED_WITH_AGENTA_SLUG

# The service default = the shared builder (single source, in the SDK) plus the two service-only
# choices: the static default skill (inlined from the reserved slug) and the declared Layer-2
# sandbox boundary the playground pre-fills. The SDK builtin interface uses the same builder
# without these, so a new default field changes one place.
_DEFAULT_AGENT_TEMPLATE = build_agent_v0_default(
    skill_slug=_DEFAULT_SKILL_SLUG,
    include_sandbox_permission=True,
)

AGENT_TEMPLATE_SCHEMA = {
    "type": "object",
    "x-ag-type-ref": "agent-template",
    "title": "Agent",
    "description": "The agent's instructions, model, tools, MCP servers, and runtime.",
    "default": _DEFAULT_AGENT_TEMPLATE,
}

AGENT_PARAMETERS_SCHEMA = {
    "$schema": _SCHEMA,
    "type": "object",
    "additionalProperties": True,
    "properties": {"agent": AGENT_TEMPLATE_SCHEMA},
}

# Outputs mirror inputs: an object with a `messages` field of type `messages` (NOT keyed by
# output surface — the old invoke/messages keying is gone). `inputs.messages` carries the turn
# in; `outputs.messages` carries the turn out. This is agent v0's departure from chat/completion,
# whose `outputs` IS the single message with no field. `flags.history` trims the list (full vs
# last) in the running layer.
AGENT_OUTPUTS_SCHEMA = {
    "$schema": _SCHEMA,
    "type": "object",
    "additionalProperties": True,
    "properties": {
        "messages": {
            "x-ag-type-ref": "messages",
            "type": "array",
            "description": "Ordered list of assistant (and tool) messages produced by the turn.",
        },
    },
}

AGENT_SCHEMAS = {
    "inputs": AGENT_INPUTS_SCHEMA,
    "parameters": AGENT_PARAMETERS_SCHEMA,
    "outputs": AGENT_OUTPUTS_SCHEMA,
}
