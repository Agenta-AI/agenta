import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

import {
    WebhookDeliveryResponse,
    WebhookSubscriptionCreateRequest,
    WebhookSubscriptionEditRequest,
    WebhookSubscriptionResponse,
    WebhookSubscriptionsResponse,
} from "./types"

const listWebhooks = async (): Promise<WebhookSubscriptionsResponse> => {
    // Backend uses POST /api/webhooks/query
    // Scoping to project_id happens via auth session injected on backend
    const response = await axios.post(`${getAgentaApiUrl()}/webhooks/query`, {})
    return response.data
}

const createWebhook = async (
    data: WebhookSubscriptionCreateRequest,
): Promise<WebhookSubscriptionResponse> => {
    const response = await axios.post(`${getAgentaApiUrl()}/webhooks/`, data)
    return response.data
}

const updateWebhook = async (
    webhookId: string,
    data: WebhookSubscriptionEditRequest,
): Promise<WebhookSubscriptionResponse> => {
    // Backend path requires {subscription_id}; body also requires it inside data
    const response = await axios.put(`${getAgentaApiUrl()}/webhooks/${webhookId}`, data)
    return response.data
}

const deleteWebhook = async (webhookId: string): Promise<void> => {
    await axios.delete(`${getAgentaApiUrl()}/webhooks/${webhookId}`)
}

const testWebhook = async (webhookId: string): Promise<WebhookDeliveryResponse> => {
    // Backend uses POST /api/webhooks/test/{subscription_id} with no body
    const response = await axios.post(`${getAgentaApiUrl()}/webhooks/test/${webhookId}`)
    return response.data
}

export {createWebhook, deleteWebhook, listWebhooks, testWebhook, updateWebhook}
