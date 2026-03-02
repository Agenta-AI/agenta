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
