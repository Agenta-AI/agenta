import axios from "@/oss/lib/api/assets/axiosConfig"
import {
    CreateWebhookSubscription,
    TestWebhookResponse,
    UpdateWebhookSubscription,
    WebhookSubscription,
} from "./types"

const fetchWebhooks = async (workspaceId: string): Promise<WebhookSubscription[]> => {
    const response = await axios.get(`/webhooks/?workspace_id=${workspaceId}`)
    return response.data
}

const createWebhook = async (
    workspaceId: string,
    data: CreateWebhookSubscription,
): Promise<WebhookSubscription> => {
    const response = await axios.post(`/webhooks/?workspace_id=${workspaceId}`, data)
    return response.data
}

const updateWebhook = async (
    workspaceId: string,
    webhookId: string,
    data: UpdateWebhookSubscription,
): Promise<WebhookSubscription> => {
    const response = await axios.put(`/webhooks/${webhookId}?workspace_id=${workspaceId}`, data)
    return response.data
}

const deleteWebhook = async (workspaceId: string, webhookId: string): Promise<void> => {
    await axios.delete(`/webhooks/${webhookId}?workspace_id=${workspaceId}`)
}

const testWebhook = async (
    workspaceId: string,
    url: string,
    eventType: string,
): Promise<TestWebhookResponse> => {
    const response = await axios.post(`/webhooks/test?workspace_id=${workspaceId}`, {
        url,
        event_type: eventType,
    })
    return response.data
}

export {createWebhook, deleteWebhook, fetchWebhooks, testWebhook, updateWebhook}
