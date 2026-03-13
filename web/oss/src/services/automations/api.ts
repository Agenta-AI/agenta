import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

import {
    WebhookSubscriptionCreateRequest,
    WebhookSubscriptionEditRequest,
    WebhookSubscriptionResponse,
    WebhookSubscriptionsResponse,
    WebhookDeliveryResponse,
} from "./types"

const createWebhookSubscription = async (
    data: WebhookSubscriptionCreateRequest,
): Promise<WebhookSubscriptionResponse> => {
    const response = await axios.post(`${getAgentaApiUrl()}/webhooks/subscriptions/`, data)
    return response.data
}

const editWebhookSubscription = async (
    webhookSubscriptionId: string,
    data: WebhookSubscriptionEditRequest,
): Promise<WebhookSubscriptionResponse> => {
    // Backend path requires {subscription_id}; body also requires it inside data
    const response = await axios.put(
        `${getAgentaApiUrl()}/webhooks/subscriptions/${webhookSubscriptionId}`,
        data,
    )
    return response.data
}

const deleteWebhookSubscription = async (webhookSubscriptionId: string): Promise<void> => {
    await axios.delete(`${getAgentaApiUrl()}/webhooks/subscriptions/${webhookSubscriptionId}`)
}

const queryWebhookSubscriptions = async (): Promise<WebhookSubscriptionsResponse> => {
    // Backend uses POST /api/webhooks/subscriptions/query
    // Scoping to project_id happens via auth session injected on backend
    const response = await axios.post(`${getAgentaApiUrl()}/webhooks/subscriptions/query`, {})
    return response.data
}

const testWebhookSubscription = async (
    webhookSubscriptionId: string,
): Promise<WebhookDeliveryResponse> => {
    // Backend uses POST /api/webhooks/subscriptions/{subscription_id}/test with no body
    const response = await axios.post(
        `${getAgentaApiUrl()}/webhooks/subscriptions/${webhookSubscriptionId}/test`,
    )
    return response.data
}

export {
    createWebhookSubscription,
    deleteWebhookSubscription,
    queryWebhookSubscriptions,
    testWebhookSubscription,
    editWebhookSubscription,
}
