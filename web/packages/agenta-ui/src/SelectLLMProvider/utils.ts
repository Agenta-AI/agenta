import {LLMIconMap} from "../LLMIcons"

/**
 * Capitalize the first letter of each word in a string.
 */
export function capitalize(str: string): string {
    if (!str) return ""
    return str
        .split(/[\s_-]+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ")
}

/**
 * Map normalized (lowercase, `_`-separated) provider keys to LLMIcons display labels.
 */
export const PROVIDER_ICON_MAP: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    // OpenAI's ChatGPT/Codex subscription provider — reuses the OpenAI mark (no distinct icon
    // asset exists). Its display name still needs to read "OpenAI Codex" — see
    // PROVIDER_DISPLAY_NAME_OVERRIDES below, since this map is also read by getProviderDisplayName.
    openai_codex: "OpenAI",
    groq: "Groq",
    mistral: "Mistral AI",
    gemini: "Google Gemini",
    google: "Google Gemini",
    cohere: "Cohere",
    anyscale: "Anyscale",
    deepinfra: "DeepInfra",
    openrouter: "OpenRouter",
    perplexity: "Perplexity AI",
    perplexityai: "Perplexity AI",
    together_ai: "Together AI",
    vertex_ai: "Google Vertex AI",
    bedrock: "AWS Bedrock",
    sagemaker: "AWS SageMaker",
    azure: "Azure OpenAI",
    fireworks: "Fireworks",
    lepton: "Lepton",
    minimax: "MiniMax",
    replicate: "Replicate",
    xai: "xAI",
}

/**
 * Normalize a provider key for icon lookup: lowercase, spaces/hyphens collapsed to `_`. Model
 * group labels are titleized upstream (`titleizeProvider`: only the first letter capitalized, e.g.
 * `together_ai` -> `"Together ai"`) so a bare `.toLowerCase()` never re-derives the `_`-joined
 * `PROVIDER_ICON_MAP` keys — this closes that gap.
 */
function normalizeProviderKey(key: string): string {
    return (key ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_")
}

/**
 * Get the icon component for a provider key.
 */
export const getProviderIcon = (key: string): React.FC<{className?: string}> | null => {
    const displayName = PROVIDER_ICON_MAP[normalizeProviderKey(key)]
    if (displayName && LLMIconMap[displayName]) return LLMIconMap[displayName]
    if (LLMIconMap[key]) return LLMIconMap[key]
    return null
}

/**
 * Display-name overrides for providers whose name must diverge from PROVIDER_ICON_MAP's
 * icon-lookup label — e.g. openai_codex reuses the OpenAI icon but must still read "OpenAI Codex".
 */
const PROVIDER_DISPLAY_NAME_OVERRIDES: Record<string, string> = {
    openai_codex: "OpenAI Codex",
}

/**
 * Get the display name for a provider key.
 */
export const getProviderDisplayName = (key: string): string => {
    const normalized = normalizeProviderKey(key)
    return (
        PROVIDER_DISPLAY_NAME_OVERRIDES[normalized] ||
        PROVIDER_ICON_MAP[normalized] ||
        capitalize(key?.replace(/_/g, " ") || "")
    )
}
