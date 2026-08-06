/**
 * Agenta TypeScript SDK — Vault (Secrets) manager.
 *
 * CRUD operations for vault secrets (provider keys, custom providers, SSO, webhooks).
 *
 * Mirrors:
 *   api/oss/src/apis/fastapi/vault/router.py
 *   api/oss/src/core/secrets/dtos.py
 */

import type {AgentaClient} from "./client"
import type {CreateSecretRequest, UpdateSecretRequest, SecretResponse} from "./types"

export class Vault {
    constructor(private readonly client: AgentaClient) {}

    /**
     * List all secrets for the current project.
     *
     * GET /secrets/
     */
    async list(): Promise<SecretResponse[]> {
        return this.client.request<SecretResponse[]>("GET", "/secrets/", {legacy: true})
    }

    /**
     * Get a single secret by ID.
     *
     * GET /secrets/{secretId}
     */
    async get(secretId: string): Promise<SecretResponse> {
        return this.client.request<SecretResponse>("GET", `/secrets/${secretId}`, {
            legacy: true,
        })
    }

    /**
     * Create a new secret.
     *
     * POST /secrets/
     */
    async create(request: CreateSecretRequest): Promise<SecretResponse> {
        return this.client.request<SecretResponse>("POST", "/secrets/", {
            body: request,
            legacy: true,
        })
    }

    /**
     * Update an existing secret.
     *
     * PUT /secrets/{secretId}
     */
    async update(secretId: string, request: UpdateSecretRequest): Promise<SecretResponse> {
        return this.client.request<SecretResponse>("PUT", `/secrets/${secretId}`, {
            body: request,
            legacy: true,
        })
    }

    /**
     * Delete a secret.
     *
     * DELETE /secrets/{secretId}
     *
     * Returns void (204 No Content).
     */
    async delete(secretId: string): Promise<void> {
        await this.client.requestRaw("DELETE", `/secrets/${secretId}`, {legacy: true})
    }
}
