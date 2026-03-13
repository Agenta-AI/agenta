import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

import {
    WebhookDeliveriesQueryRequest,
    WebhookDeliveriesResponse,
    WebhookSubscriptionDraftTestRequest,
    WebhookSubscriptionCreateRequest,
    WebhookSubscriptionEditRequest,
    WebhookDeliveryResponse,
    WebhookSubscriptionResponse,
    WebhookSubscriptionsResponse,
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

const testWebhookDraft = async (
    data: WebhookSubscriptionDraftTestRequest,
): Promise<WebhookDeliveryResponse> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/webhooks/subscriptions/test-draft`,
        data,
    )
    return response.data
}

const queryWebhookDeliveries = async (
    data: WebhookDeliveriesQueryRequest,
): Promise<WebhookDeliveriesResponse> => {
    const response = await axios.post(`${getAgentaApiUrl()}/webhooks/deliveries/query`, data)
    return response.data
}

export {
    createWebhookSubscription,
    deleteWebhookSubscription,
    queryWebhookDeliveries,
    queryWebhookSubscriptions,
    testWebhookDraft,
    testWebhookSubscription,
    editWebhookSubscription,
}
