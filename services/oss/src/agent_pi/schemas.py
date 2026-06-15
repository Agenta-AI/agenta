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

# Parameters: the agent config the playground renders as editable fields. Exposes
# the two values that actually drive a run: the model and the AGENTS.md instructions.
# `x-parameters.multiline` is the hint the playground honors to render a textarea.
AGENT_PARAMETERS_SCHEMA = {
    "$schema": _SCHEMA,
    "type": "object",
    "additionalProperties": True,
    "properties": {
        "model": {
            "type": "string",
            "default": _DEFAULT_MODEL,
            "description": "Model the agent runs on.",
        },
        "agents_md": {
            "type": "string",
            "default": _DEFAULT_AGENTS_MD,
            "description": "The agent's instructions (AGENTS.md).",
            "x-parameters": {"multiline": True},
        },
    },
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
