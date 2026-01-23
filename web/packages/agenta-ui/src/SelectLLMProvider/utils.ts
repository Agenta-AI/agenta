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
 * Map lowercase provider keys to LLMIcons display labels.
 */
export const PROVIDER_ICON_MAP: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    groq: "Groq",
    mistral: "Mistral AI",
    gemini: "Google Gemini",
    cohere: "Cohere",
    deepinfra: "DeepInfra",
    openrouter: "OpenRouter",
    perplexity: "Perplexity AI",
    together_ai: "Together AI",
    vertex_ai: "Google Vertex AI",
    bedrock: "AWS Bedrock",
    azure: "Azure OpenAI",
    fireworks: "Fireworks",
    lepton: "Lepton",
    replicate: "Replicate",
    xai: "xAI",
}

/**
 * Get the icon component for a provider key.
 */
export const getProviderIcon = (key: string): React.FC<{className?: string}> | null => {
    const displayName = PROVIDER_ICON_MAP[key?.toLowerCase()]
    if (displayName && LLMIconMap[displayName]) return LLMIconMap[displayName]
    if (LLMIconMap[key]) return LLMIconMap[key]
    return null
}

/**
 * Get the display name for a provider key.
 */
export const getProviderDisplayName = (key: string): string => {
    return PROVIDER_ICON_MAP[key?.toLowerCase()] || capitalize(key?.replace(/_/g, " ") || "")
}
