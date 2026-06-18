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
# agent config, instead of reusing `prompt-template` plus loose params. The
# `x-ag-type: agent_config` marker is what the playground dispatches to the AgentConfigControl
# (web/packages/agenta-entity-ui/.../AgentConfigControl.tsx). The schema is inline (not an
# `x-ag-type-ref`), so it needs no `/ag-types` registration; the control reuses the existing
# model selector, tool picker, and enum selects. agent.py reads this value (see inputs.py).
_DEFAULT_AGENT_CONFIG = {
    "instructions": _DEFAULT_AGENTS_MD,
    "model": _DEFAULT_MODEL,
    "tools": [],
    "harness": "pi",
    "sandbox": "local",
    "permission_policy": "auto",
}

AGENT_CONFIG_SCHEMA = {
    "type": "object",
    "x-ag-type": "agent_config",
    "title": "Agent",
    "description": "The agent's instructions, model, tools, and runtime.",
    "properties": {
        "instructions": {
            "type": "string",
            "x-ag-type": "textarea",
            "title": "Instructions",
            "description": "The agent's system prompt (its AGENTS.md).",
            "default": _DEFAULT_AGENTS_MD,
        },
        "model": {
            "type": "string",
            "x-parameter": "grouped_choice",
            "title": "Model",
            "default": _DEFAULT_MODEL,
        },
        "tools": {
            "type": "array",
            "title": "Tools",
            "description": (
                "Runnable tools the agent can call. Picked from connected providers "
                "(e.g. Composio) and run server-side via /tools/call."
            ),
            "items": {"type": "object", "additionalProperties": True},
            "default": [],
        },
        "harness": {
            "type": "string",
            "title": "Harness",
            "enum": ["pi", "claude", "agenta"],
            "default": "pi",
            "description": (
                "Coding agent to drive: pi, claude, or agenta (pi with Agenta's forced "
                "skills, tools, and base instructions)."
            ),
        },
        "sandbox": {
            "type": "string",
            "title": "Sandbox",
            "enum": ["local", "daytona"],
            "default": "local",
            "description": "Where the agent runs: local daemon or a Daytona sandbox.",
        },
        "permission_policy": {
            "type": "string",
            "title": "Permission policy",
            "enum": ["auto", "deny"],
            "default": "auto",
            "description": (
                "How a permission-gating harness (e.g. Claude Code) handles tool-use "
                "prompts in this headless run: auto-approve or deny."
            ),
        },
    },
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
