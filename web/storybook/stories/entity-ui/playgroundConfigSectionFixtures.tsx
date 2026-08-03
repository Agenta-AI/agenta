/**
 * Shared props for the PlaygroundConfigSection parity stories. The chunk is fully
 * presentational (zero atom hooks), so these are plain literals — no data seam needed.
 */
import type {EntitySchemaProperty} from "@agenta/entities/shared"

export const MODEL_OPTIONS = [
    {
        label: "OpenAI",
        options: [
            {label: "gpt-4o", value: "gpt-4o"},
            {label: "gpt-4o-mini", value: "gpt-4o-mini"},
        ],
    },
    {
        label: "Anthropic",
        options: [{label: "claude-sonnet-4", value: "claude-sonnet-4"}],
    },
]

export const LLM_CONFIG_PROPS: Record<string, EntitySchemaProperty> = {
    temperature: {
        type: "number",
        title: "Temperature",
        minimum: 0,
        maximum: 2,
        description: "Higher values make the output more random.",
    },
    max_tokens: {type: "integer", title: "Max Tokens", minimum: 1, maximum: 4096},
    tool_choice: {type: "string", title: "Tool Choice", enum: ["auto", "none", "required"]},
    chat_template_kwargs: {type: "object", title: "Chat Template Kwargs"},
} as unknown as Record<string, EntitySchemaProperty>

export const ADVANCED_ENTRIES: [string, unknown][] = [
    ["chat_template_kwargs", LLM_CONFIG_PROPS.chat_template_kwargs],
]

export const FALLBACK_POLICY_OPTIONS = [
    {label: "Off", value: "off", description: "Never fall back"},
    {label: "Availability", value: "availability", description: "Provider is down"},
    {label: "Any", value: "any", description: "Any failure"},
]

export const RETRY_POLICY_OPTIONS = [
    {label: "Off", value: "off", description: "Never retry"},
    {label: "Capacity", value: "capacity", description: "Rate limited"},
    {label: "Any", value: "any", description: "Any failure"},
]

export const FALLBACK_POLICY_SCHEMA = {
    title: "Fallback Policy",
    description: "Choose which failure types should try the fallback model list.",
} as EntitySchemaProperty

export const FALLBACK_CONFIGS_SCHEMA = {
    title: "Fallback Configs",
    description: "Add fallback models for the selected policy.",
} as EntitySchemaProperty

export const RETRY_POLICY_SCHEMA = {
    title: "Retry Policy",
    description: "Choose which failure types should trigger another request attempt.",
} as EntitySchemaProperty

export const RETRY_CONFIG_SCHEMA = {
    type: "object",
    properties: {
        max_retries: {type: "integer", title: "Max Retries", minimum: 0, maximum: 10},
        base_delay: {type: "integer", title: "Base Delay", minimum: 0, maximum: 5000},
    },
} as unknown as EntitySchemaProperty

export const FALLBACK_CONFIGS = [{model: "gpt-4o-mini"}, {model: "claude-sonnet-4"}]
export const FALLBACK_CONFIG_KEYS = ["fb-1", "fb-2"]

export const noop = () => undefined

// --- configure-popover shell fixtures (legacy nested `prompt` shape) ---------

export const POPOVER_LLM_CONFIG_PROPS = {
    temperature: LLM_CONFIG_PROPS.temperature,
    max_tokens: LLM_CONFIG_PROPS.max_tokens,
    chat_template_kwargs: LLM_CONFIG_PROPS.chat_template_kwargs,
} as unknown as Record<string, EntitySchemaProperty>

export const POPOVER_LLM_CONFIG_VALUE = {
    model: "gpt-4o",
    temperature: 0.7,
    max_tokens: 512,
}

const PROMPT_EXTENSION_SCHEMA = {
    fallback_policy: {
        title: "Fallback Policy",
        description: "Choose which failure types should try the fallback model list.",
        enum: ["off", "availability", "any"],
        "x-ag-metadata": {
            off: {description: "Never fall back"},
            availability: {description: "Provider is down"},
            any: {description: "Any failure"},
        },
    },
    fallback_configs: {
        title: "Fallback Configs",
        description: "Add fallback models for the selected policy.",
    },
    retry_policy: {
        title: "Retry Policy",
        description: "Choose which failure types should trigger another request attempt.",
        enum: ["off", "capacity", "any"],
        "x-ag-metadata": {
            off: {description: "Never retry"},
            capacity: {description: "Rate limited"},
            any: {description: "Any failure"},
        },
    },
    retry_config: RETRY_CONFIG_SCHEMA,
}

const PROMPT_LLM_CONFIG_SCHEMA = {
    type: "object",
    properties: {
        model: {type: "string", title: "Model"},
        ...POPOVER_LLM_CONFIG_PROPS,
    },
}

export const POPOVER_PARAMETERS = {
    prompt: {
        messages: [],
        llm_config: POPOVER_LLM_CONFIG_VALUE,
        fallback_policy: "availability",
        fallback_configs: FALLBACK_CONFIGS,
        retry_policy: "capacity",
        retry_config: {max_retries: 3, base_delay: 500},
    },
}

export const POPOVER_SCHEMA = {
    type: "object",
    properties: {
        prompt: {
            type: "object",
            properties: {llm_config: PROMPT_LLM_CONFIG_SCHEMA, ...PROMPT_EXTENSION_SCHEMA},
        },
    },
}

/** Same prompt without the fallback/retry extension keys — the popover shows a single tab. */
export const POPOVER_PARAMETERS_NO_EXTENSIONS = {
    prompt: {messages: [], llm_config: POPOVER_LLM_CONFIG_VALUE},
}

export const POPOVER_SCHEMA_NO_EXTENSIONS = {
    type: "object",
    properties: {
        prompt: {type: "object", properties: {llm_config: PROMPT_LLM_CONFIG_SCHEMA}},
    },
}
