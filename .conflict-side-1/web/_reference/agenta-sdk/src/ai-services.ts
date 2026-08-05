/**
 * Agenta TypeScript SDK — AI Services manager.
 *
 * AI-powered tools like prompt refinement.
 *
 * Endpoints are under /ai/services/ (legacy, no /preview prefix).
 */

import type {AgentaClient} from "./client"
import type {AIServicesStatus, AIServiceToolCallResponse} from "./types"

export class AIServices {
    constructor(private readonly client: AgentaClient) {}

    /**
     * Check if AI services are enabled and get available tools.
     *
     * GET /ai/services/status
     */
    async getStatus(): Promise<AIServicesStatus> {
        return this.client.get<AIServicesStatus>("/ai/services/status", {legacy: true})
    }

    /**
     * Execute an AI service tool call.
     *
     * POST /ai/services/tools/call
     */
    async callTool(
        name: string,
        args: Record<string, unknown>,
    ): Promise<AIServiceToolCallResponse> {
        return this.client.post<AIServiceToolCallResponse>(
            "/ai/services/tools/call",
            {name, arguments: args},
            {legacy: true},
        )
    }
}
