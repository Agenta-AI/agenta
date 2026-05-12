/**
 * Example: fetch a prompt from the Agenta registry and use it.
 *
 * Demonstrates:
 * - Constructing an `Agenta` client from env vars
 * - Fetching one prompt by slug from the production environment
 * - Falling back to a local default if Agenta is unreachable
 * - Handling the typed errors a real consumer hits (auth / not-found / rate-limit)
 *
 * Run:
 *   AGENTA_API_KEY=sk-... AGENTA_PROJECT_ID=... pnpm tsx examples/fetch-prompt.ts
 */

import {
    Agenta,
    AgentaApiError,
    AgentaAuthError,
    AgentaNotFoundError,
    AgentaRateLimitError,
} from "../src/index"

async function main() {
    if (!process.env.AGENTA_API_KEY) {
        console.error("Set AGENTA_API_KEY before running this example.")
        process.exit(1)
    }

    const ag = new Agenta({
        host: process.env.AGENTA_HOST ?? "https://cloud.agenta.ai",
        apiKey: process.env.AGENTA_API_KEY,
        projectId: process.env.AGENTA_PROJECT_ID,
    })

    const PROMPT_SLUG = process.env.PROMPT_SLUG ?? "customer-support-system"
    const ENVIRONMENT = process.env.PROMPT_ENV ?? "production"

    try {
        const result = await ag.prompts.fetch({
            slugs: [PROMPT_SLUG],
            environment: ENVIRONMENT,
            fallbacks: {
                [PROMPT_SLUG]: "You are a helpful assistant. Be concise.",
            },
        })

        console.log("Source:           ", result.source) // environment | latest | fallback
        console.log("Application ID:   ", result.applicationId)
        console.log("Revision ID:      ", result.revisionId)
        console.log("Tool schemas:     ", Object.keys(result.toolSchemas))
        console.log("--- prompt content ---")
        console.log(result.instructions)
        console.log("----------------------")

        // The instructions string is now ready to use as a system message
        // with any LLM client (OpenAI, Anthropic, Vercel AI SDK, etc.).
    } catch (err) {
        if (err instanceof AgentaAuthError) {
            console.error("Auth failed (status", err.status + "):", err.detail)
            console.error("Check that AGENTA_API_KEY is correct and not expired.")
        } else if (err instanceof AgentaNotFoundError) {
            console.error(`Prompt slug "${PROMPT_SLUG}" not found in env "${ENVIRONMENT}".`)
            console.error("Either the slug is wrong, or it hasn't been deployed yet.")
        } else if (err instanceof AgentaRateLimitError) {
            console.error("Rate limited. Retry after", err.retryAfterMs, "ms.")
        } else if (err instanceof AgentaApiError) {
            console.error("Agenta API error:", err.status, err.detail)
        } else {
            throw err
        }
        process.exit(1)
    }
}

main().catch((err) => {
    console.error("Unexpected error:", err)
    process.exit(1)
})
