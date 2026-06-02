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
 * runnable locally ("Failed to connect to upstream service"). This mock
 * lets you exercise the Refine Prompt modal — and specifically verify the
 * apply-doesn't-revert fix — without that service.
 *
 * Enable it either way:
 *   - Env (needs dev-server restart):  NEXT_PUBLIC_MOCK_REFINE_PROMPT=true
 *   - Runtime (no restart, just reload the page after setting):
 *       localStorage.setItem("agenta:mock-refine-prompt", "true")
 *
 * The mock prepends a visible `[refined]` marker to every message's
 * content. That makes the revert-bug observable: click "Use refined
 * prompt" → the editor should show `[refined] …`; if the old race
 * regressed, the marker would disappear as the editor reverts to the
 * pre-refine content. It also honours a couple of magic guidelines so
 * you can exercise the error / empty branches:
 *   - guidelines containing "error"  → returns `isError: true`
 *   - guidelines containing "noop"   → returns the prompt unchanged
 *
 * Off by default — zero production impact (both checks resolve falsy).
 */
function isRefineMockEnabled(): boolean {
    if (process.env.NEXT_PUBLIC_MOCK_REFINE_PROMPT === "true") return true
    if (typeof window !== "undefined") {
        try {
            return window.localStorage.getItem("agenta:mock-refine-prompt") === "true"
        } catch {
            // localStorage can throw in private-mode / sandboxed contexts.
        }
    }
    return false
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
        if (isRefineMockEnabled()) {
            // Simulate a bit of network latency so the apply flow runs
            // against a realistic async boundary (the original revert bug
            // was a race; the delay makes any regression easier to catch).
            await new Promise((resolve) => setTimeout(resolve, 600))
            return buildMockRefineResponse(promptTemplate, guidelines)
        }

        const {data} = await axios.post<ToolCallResponse>("/ai/services/tools/call", {
            name: TOOL_REFINE_PROMPT,
            arguments: {
                prompt_template_json: JSON.stringify(promptTemplate),
                guidelines,
                context: context || "",
            },
        })
        return data
    },
}

export default aiServicesApi
