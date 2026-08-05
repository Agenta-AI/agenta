/**
 * Agenta TypeScript SDK — Webhooks manager.
 *
 * CRUD operations for webhook subscriptions and deliveries.
 *
 * Endpoints:
 *   POST   /webhooks/subscriptions/           → create
 *   PUT    /webhooks/subscriptions/:id         → edit
 *   DELETE /webhooks/subscriptions/:id         → delete
 *   POST   /webhooks/subscriptions/query       → query
 *   POST   /webhooks/subscriptions/test        → test
 *   POST   /webhooks/deliveries/query          → queryDeliveries
 */

import type {AgentaClient} from "./client"
import type {
    WebhookSubscriptionCreateRequest,
    WebhookSubscriptionEditRequest,
    WebhookSubscriptionTestRequest,
    WebhookSubscriptionResponse,
    WebhookSubscriptionsResponse,
    WebhookDeliveriesQueryRequest,
    WebhookDeliveriesResponse,
    WebhookDeliveryResponse,
} from "./types"

export class Webhooks {
    constructor(private readonly client: AgentaClient) {}

    /**
     * Create a webhook subscription.
     */
    async create(request: WebhookSubscriptionCreateRequest): Promise<WebhookSubscriptionResponse> {
        return this.client.post<WebhookSubscriptionResponse>("/webhooks/subscriptions/", request, {
            legacy: true,
        })
    }

    /**
     * Edit a webhook subscription.
     */
    async edit(
        subscriptionId: string,
        request: WebhookSubscriptionEditRequest,
    ): Promise<WebhookSubscriptionResponse> {
        return this.client.put<WebhookSubscriptionResponse>(
            `/webhooks/subscriptions/${subscriptionId}`,
            request,
            {legacy: true},
        )
    }

    /**
     * Delete a webhook subscription.
     */
    async delete(subscriptionId: string): Promise<void> {
        await this.client.delete(`/webhooks/subscriptions/${subscriptionId}`, {legacy: true})
    }

    /**
     * Query webhook subscriptions.
     */
    async query(): Promise<WebhookSubscriptionsResponse> {
        return this.client.post<WebhookSubscriptionsResponse>(
            "/webhooks/subscriptions/query",
            {},
            {legacy: true},
        )
    }

    /**
     * Test a webhook subscription.
     */
    async test(request: WebhookSubscriptionTestRequest): Promise<WebhookDeliveryResponse> {
        return this.client.post<WebhookDeliveryResponse>("/webhooks/subscriptions/test", request, {
            legacy: true,
        })
    }

    /**
     * Query webhook deliveries.
     */
    async queryDeliveries(
        request: WebhookDeliveriesQueryRequest,
    ): Promise<WebhookDeliveriesResponse> {
        return this.client.post<WebhookDeliveriesResponse>("/webhooks/deliveries/query", request, {
            legacy: true,
        })
    }
}
