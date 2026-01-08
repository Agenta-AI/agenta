/**
 * Webhook API client
 */

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

import type {
    Webhook,
    WebhookExecution,
    CreateWebhookPayload,
    UpdateWebhookPayload,
} from "./types"

/**
 * Webhook API service
 */
export const webhookService = {
    /**
     * Create a new webhook
     */
    async createWebhook(payload: CreateWebhookPayload): Promise<Webhook> {
        const response = await axios.post(
            `${getAgentaApiUrl()}/webhooks/`,
            payload
        )
        return response.data
    },

    /**
     * List all webhooks for a project
     * Optionally filter by app_id
     */
    async listWebhooks(
        projectId: string,
        appId?: string
    ): Promise<Webhook[]> {
        const params: {project_id: string; app_id?: string} = {
            project_id: projectId,
        }
        if (appId) {
            params.app_id = appId
        }
        const response = await axios.get(
            `${getAgentaApiUrl()}/webhooks/`,
            {params}
        )
        return response.data
    },

    /**
     * Get a single webhook by ID
     */
    async getWebhook(webhookId: string): Promise<Webhook> {
        const response = await axios.get(
            `${getAgentaApiUrl()}/webhooks/${webhookId}/`
        )
        return response.data
    },

    /**
     * Update a webhook
     */
    async updateWebhook(
        webhookId: string,
        payload: UpdateWebhookPayload
    ): Promise<Webhook> {
        const response = await axios.put(
            `${getAgentaApiUrl()}/webhooks/${webhookId}/`,
            payload
        )
        return response.data
    },

    /**
     * Delete a webhook
     */
    async deleteWebhook(webhookId: string): Promise<void> {
        await axios.delete(
            `${getAgentaApiUrl()}/webhooks/${webhookId}/`
        )
    },

    /**
     * List webhook execution history
     */
    async listExecutions(
        webhookId: string,
        limit = 50,
        offset = 0
    ): Promise<WebhookExecution[]> {
        const response = await axios.get(
            `${getAgentaApiUrl()}/webhooks/${webhookId}/executions/`,
            {params: {limit, offset}}
        )
        return response.data
    },

    /**
     * Get a single webhook execution
     */
    async getExecution(executionId: string): Promise<WebhookExecution> {
        const response = await axios.get(
            `${getAgentaApiUrl()}/webhooks/executions/${executionId}/`
        )
        return response.data
    },
}
