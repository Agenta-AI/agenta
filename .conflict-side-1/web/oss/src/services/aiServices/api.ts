/**
 * AI Services API Client
 *
 * Client for interacting with the AI Services backend endpoints:
 * - GET /ai/services/status - Check if AI services are enabled
 * - POST /ai/services/tools/call - Execute a tool call (e.g., refine prompt)
 */

import type {PromptTemplate} from "@/oss/components/Playground/Components/Modals/RefinePromptModal/types"
import axios from "@/oss/lib/api/assets/axiosConfig"

// Tool name constant
export const TOOL_REFINE_PROMPT = "tools.agenta.api.refine_prompt"

/**
 * Response from GET /ai/services/status
 */
export interface AIServicesStatus {
    enabled: boolean
    tools: {
        name: string
        title: string
        description: string
        inputSchema?: Record<string, unknown>
        outputSchema?: Record<string, unknown>
    }[]
}

/**
 * Response from POST /ai/services/tools/call
 */
export interface ToolCallResponse {
    content: {type: "text"; text: string}[]
    structuredContent?: {
        messages: {role: string; content: string}[]
        summary?: string
    }
    isError: boolean
    meta?: {trace_id?: string}
}

/**
 * LOCAL-DEV MOCK for the refine-prompt tool.
 *
 * The refine endpoint hits an upstream AI service that isn't trivially
 * runnable locally ("AI services are disabled" / "Failed to connect to
 * upstream service"). This mock lets you exercise the Refine Prompt modal
 * — and specifically verify the apply-doesn't-revert fix — without it.
 *
 * Three modes (see `getRefineMockMode`):
 *   - "force": always mock, never hit the network. Set via env
 *       `NEXT_PUBLIC_MOCK_REFINE_PROMPT=true` (restart) or
 *       `localStorage["agenta:mock-refine-prompt"] = "true"` (reload).
 *   - "off": never mock — surface the real error. Set
 *       `localStorage["agenta:mock-refine-prompt"] = "false"`.
 *   - "auto" (DEFAULT in dev): try the real endpoint; if it errors AND
 *       we're not in production, fall back to the mock with a console
 *       warning. This is what makes refine "just work" locally without
 *       any setup. In production the real service responds, so the
 *       fallback never fires — and even if it threw, the `NODE_ENV`
 *       guard re-throws.
 *
 * The mock prepends a visible `[refined] ` marker to every message's
 * content. That makes the revert-bug observable: click "Use refined
 * prompt" → the editor should show `[refined] …`; if the old race
 * regressed, the marker would disappear as the editor reverts to the
 * pre-refine content. Magic guidelines for the other branches:
 *   - guidelines containing "error" → returns `isError: true`
 *   - guidelines containing "noop"  → returns the prompt unchanged
 */
type RefineMockMode = "force" | "off" | "auto"

function getRefineMockMode(): RefineMockMode {
    if (process.env.NEXT_PUBLIC_MOCK_REFINE_PROMPT === "true") return "force"
    if (typeof window !== "undefined") {
        try {
            const v = window.localStorage.getItem("agenta:mock-refine-prompt")
            if (v === "true") return "force"
            if (v === "false") return "off"
        } catch {
            // localStorage can throw in private-mode / sandboxed contexts.
        }
    }
    return "auto"
}

function buildMockRefineResponse(
    promptTemplate: PromptTemplate,
    guidelines: string,
): ToolCallResponse {
    const g = guidelines.toLowerCase()

    if (g.includes("error")) {
        return {
            content: [{type: "text", text: "Mock refine error (guidelines contained 'error')."}],
            isError: true,
        }
    }

    const sourceMessages = Array.isArray(promptTemplate.messages) ? promptTemplate.messages : []

    const refinedMessages = sourceMessages.map((m) => {
        const role = typeof m?.role === "string" ? m.role : "user"
        const content = typeof m?.content === "string" ? m.content : ""
        if (g.includes("noop")) return {role, content}
        // Visible, idempotent-ish transform: prepend a marker unless it's
        // already there (so repeated refines don't stack markers).
        const refined = content.startsWith("[refined] ") ? content : `[refined] ${content}`
        return {role, content: refined}
    })

    return {
        content: [{type: "text", text: "Mock refined the prompt."}],
        structuredContent: {
            messages: refinedMessages,
            summary: g.includes("noop")
                ? "Mock: returned the prompt unchanged."
                : `Mock: prepended a [refined] marker to ${refinedMessages.length} message(s).`,
        },
        isError: false,
        meta: {trace_id: "mock-trace-id"},
    }
}

/**
 * AI Services API methods
 */
export const aiServicesApi = {
    /**
     * Check if AI services are enabled and get available tools
     */
    async getStatus(): Promise<AIServicesStatus> {
        const {data} = await axios.get<AIServicesStatus>("/ai/services/status")
        return data
    },

    /**
     * Refine a prompt template using AI
     *
     * @param promptTemplate - The current prompt template to refine
     * @param guidelines - User's instructions for how to refine the prompt
     * @param context - Optional additional context
     * @returns The refined prompt and explanation
     */
    async refinePrompt(
        promptTemplate: PromptTemplate,
        guidelines: string,
        context?: string,
    ): Promise<ToolCallResponse> {
        const mode = getRefineMockMode()

        if (mode === "force") {
            // Simulate a bit of network latency so the apply flow runs
            // against a realistic async boundary (the original revert bug
            // was a race; the delay makes any regression easier to catch).
            await new Promise((resolve) => setTimeout(resolve, 600))
            return buildMockRefineResponse(promptTemplate, guidelines)
        }

        try {
            const {data} = await axios.post<ToolCallResponse>(
                "/ai/services/tools/call",
                {
                    name: TOOL_REFINE_PROMPT,
                    arguments: {
                        prompt_template_json: JSON.stringify(promptTemplate),
                        guidelines,
                        context: context || "",
                    },
                },
                // `_ignoreError` makes the shared axios response interceptor
                // skip `globalErrorHandler` (which pops the Next.js error
                // overlay for every non-GET failure) and just re-throw —
                // so our catch below can fall back to the mock SILENTLY in
                // dev. Without this, the overlay fires before our catch
                // runs, even though the rejection is handled. The modal /
                // hook surfaces its own user-facing error from the thrown
                // value when the fallback doesn't apply (prod).
                {_ignoreError: true} as Record<string, unknown>,
            )
            return data
        } catch (err) {
            // Dev convenience: when the AI service is unavailable locally
            // (disabled / upstream down), fall back to the mock instead of
            // surfacing a runtime error — so the modal stays testable with
            // zero setup. Skipped in production (real service responds) and
            // when explicitly disabled (`localStorage[...] = "false"`).
            const isProd = process.env.NODE_ENV === "production"
            if (!isProd && mode === "auto") {
                // console.warn(
                //     "[refinePrompt] AI service unavailable — falling back to the local mock. " +
                //         'Set localStorage["agenta:mock-refine-prompt"] = "false" to see the real error.',
                //     err,
                // )
                return buildMockRefineResponse(promptTemplate, guidelines)
            }
            throw err
        }
    },
}

export default aiServicesApi
