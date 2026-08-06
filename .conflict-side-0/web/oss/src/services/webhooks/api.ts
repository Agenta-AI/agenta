import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

import {
    WebhookDeliveriesQueryRequest,
    WebhookDeliveriesResponse,
    WebhookSubscriptionTestRequest,
    WebhookSubscriptionCreateRequest,
    WebhookSubscriptionEditRequest,
    WebhookDeliveryResponse,
    WebhookSubscriptionResponse,
    WebhookSubscriptionsResponse,
} from "./types"

const createWebhookSubscription = async (
    data: WebhookSubscriptionCreateRequest,
    projectId?: string,
): Promise<WebhookSubscriptionResponse> => {
    const response = await axios.post(`${getAgentaApiUrl()}/webhooks/subscriptions/`, data, {
        params: projectId ? {project_id: projectId} : undefined,
    })
    return response.data
}

const editWebhookSubscription = async (
    webhookSubscriptionId: string,
    data: WebhookSubscriptionEditRequest,
    projectId?: string,
): Promise<WebhookSubscriptionResponse> => {
    const response = await axios.put(
        `${getAgentaApiUrl()}/webhooks/subscriptions/${webhookSubscriptionId}`,
        data,
        {params: projectId ? {project_id: projectId} : undefined},
    )
    return response.data
}

const deleteWebhookSubscription = async (
    webhookSubscriptionId: string,
    projectId?: string,
): Promise<void> => {
    await axios.delete(`${getAgentaApiUrl()}/webhooks/subscriptions/${webhookSubscriptionId}`, {
        params: projectId ? {project_id: projectId} : undefined,
    })
}

const queryWebhookSubscriptions = async (
    projectId?: string,
): Promise<WebhookSubscriptionsResponse> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/webhooks/subscriptions/query`,
        {},
        {params: projectId ? {project_id: projectId} : undefined},
    )
    return response.data
}

// Lifecycle verbs toggling `flags.is_active` (WP6). Mirror the trigger
// subscription/schedule start/stop routes: POST /subscriptions/{id}/{verb}.
const startWebhookSubscription = async (
    webhookSubscriptionId: string,
    projectId?: string,
): Promise<WebhookSubscriptionResponse> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/webhooks/subscriptions/${webhookSubscriptionId}/start`,
        {},
        {params: projectId ? {project_id: projectId} : undefined},
    )
    return response.data
}

const stopWebhookSubscription = async (
    webhookSubscriptionId: string,
    projectId?: string,
): Promise<WebhookSubscriptionResponse> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}/webhooks/subscriptions/${webhookSubscriptionId}/stop`,
        {},
        {params: projectId ? {project_id: projectId} : undefined},
    )
    return response.data
}

const testWebhookSubscription = async (
    data: WebhookSubscriptionTestRequest,
    projectId?: string,
): Promise<WebhookDeliveryResponse> => {
    const response = await axios.post(`${getAgentaApiUrl()}/webhooks/subscriptions/test`, data, {
        params: projectId ? {project_id: projectId} : undefined,
    })
    return response.data
}

const queryWebhookDeliveries = async (
    data: WebhookDeliveriesQueryRequest,
    projectId?: string,
): Promise<WebhookDeliveriesResponse> => {
    const response = await axios.post(`${getAgentaApiUrl()}/webhooks/deliveries/query`, data, {
        params: projectId ? {project_id: projectId} : undefined,
    })
    return response.data
}

export {
    createWebhookSubscription,
    deleteWebhookSubscription,
    queryWebhookDeliveries,
    queryWebhookSubscriptions,
    startWebhookSubscription,
    stopWebhookSubscription,
    testWebhookSubscription,
    editWebhookSubscription,
}
