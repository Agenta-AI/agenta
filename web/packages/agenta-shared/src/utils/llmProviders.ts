import type {LlmProvider} from "../types/llmProvider"

/**
 * LocalStorage key for legacy provider-key storage.
 *
 * Predates the vault-backed secret system. Used by the migration atom
 * in `@agenta/entities/secret` to detect and migrate legacy keys into
 * server-side vault storage on first authenticated load.
 */
export const llmAvailableProvidersToken = "llmAvailableProvidersToken"

/**
 * Canonical list of standard LLM providers supported by Agenta.
 *
 * Each entry maps a display title to its environment-variable name
 * (which is also the key the vault uses to identify provider secrets
 * via `SecretDTOProvider`). Used by the secret entity to seed the
 * standard-provider list and by UI components for provider selection.
 */
/**
 * Normalize a provider family / vault env-var name / display title so the three representations
 * compare equal: lowercase, then strip everything but letters and digits. Without this, a
 * multi-word family like `together_ai` never matches its vault env name `TOGETHERAI_API_KEY`
 * (once the `_API_KEY` suffix is stripped) or its title `"Together AI"` — the underscore/space
 * differs. Used wherever a model's provider family must be matched against a vault secret.
 */
export function normalizeProviderFamily(value: string | null | undefined): string {
    return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

export const llmAvailableProviders: LlmProvider[] = [
    {title: "OpenAI", key: "", name: "OPENAI_API_KEY"},
    {title: "Mistral AI", key: "", name: "MISTRAL_API_KEY"},
    {title: "Cohere", key: "", name: "COHERE_API_KEY"},
    {title: "Anthropic", key: "", name: "ANTHROPIC_API_KEY"},
    {title: "Anyscale", key: "", name: "ANYSCALE_API_KEY"},
    {title: "Perplexity AI", key: "", name: "PERPLEXITYAI_API_KEY"},
    {title: "DeepInfra", key: "", name: "DEEPINFRA_API_KEY"},
    {title: "Together AI", key: "", name: "TOGETHER_API_KEY"},
    {title: "Aleph Alpha", key: "", name: "ALEPHALPHA_API_KEY"},
    {title: "OpenRouter", key: "", name: "OPENROUTER_API_KEY"},
    {title: "Groq", key: "", name: "GROQ_API_KEY"},
    {title: "Google Gemini", key: "", name: "GEMINI_API_KEY"},
    {title: "MiniMax", key: "", name: "MINIMAX_API_KEY"},
]
