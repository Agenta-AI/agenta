/**
 * Agenta TypeScript SDK — API Keys manager.
 *
 * CRUD operations for workspace API keys.
 *
 * Endpoints are under /keys/ (legacy, no /preview prefix).
 */

import type {AgentaClient} from "./client"
import type {ApiKeyItem} from "./types"

export class ApiKeys {
    constructor(private readonly client: AgentaClient) {}

    /**
     * List all API keys for a workspace.
     *
     * GET /keys/?workspace_id=...
     */
    async list(workspaceId: string): Promise<ApiKeyItem[]> {
        return this.client.get<ApiKeyItem[]>("/keys/", {
            legacy: true,
            params: {workspace_id: workspaceId},
        })
    }

    /**
     * Create a new API key.
     *
     * POST /keys/?workspace_id=...
     */
    async create(workspaceId: string): Promise<string> {
        return this.client.post<string>("/keys", null, {
            legacy: true,
            params: {workspace_id: workspaceId},
        })
    }

    /**
     * Delete an API key by prefix.
     *
     * DELETE /keys/{prefix}
     */
    async delete(prefix: string): Promise<void> {
        await this.client.request("DELETE", `/keys/${prefix}`, {legacy: true})
    }
}
