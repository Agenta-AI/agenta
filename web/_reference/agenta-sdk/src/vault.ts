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
     * GET /vault/v1/secrets/
     */
    async list(): Promise<SecretResponse[]> {
        return this.client.request<SecretResponse[]>("GET", "/vault/v1/secrets/", {legacy: true})
    }

    /**
     * Get a single secret by ID.
     *
     * GET /vault/v1/secrets/{secretId}
     */
    async get(secretId: string): Promise<SecretResponse> {
        return this.client.request<SecretResponse>("GET", `/vault/v1/secrets/${secretId}`, {
            legacy: true,
        })
    }

    /**
     * Create a new secret.
     *
     * POST /vault/v1/secrets/
     */
    async create(request: CreateSecretRequest): Promise<SecretResponse> {
        return this.client.request<SecretResponse>("POST", "/vault/v1/secrets/", {
            body: request,
            legacy: true,
        })
    }

    /**
     * Update an existing secret.
     *
     * PUT /vault/v1/secrets/{secretId}
     */
    async update(secretId: string, request: UpdateSecretRequest): Promise<SecretResponse> {
        return this.client.request<SecretResponse>("PUT", `/vault/v1/secrets/${secretId}`, {
            body: request,
            legacy: true,
        })
    }

    /**
     * Delete a secret.
     *
     * DELETE /vault/v1/secrets/{secretId}
     *
     * Returns void (204 No Content).
     */
    async delete(secretId: string): Promise<void> {
        await this.client.requestRaw("DELETE", `/vault/v1/secrets/${secretId}`, {legacy: true})
    }
}
