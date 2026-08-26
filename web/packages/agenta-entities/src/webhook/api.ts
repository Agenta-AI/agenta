import {getWebhooksClient} from "@agenta/sdk/resources"

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

/**
 * Webhook subscriptions and deliveries, over the Fern webhooks resource.
 *
 * `project_id` is not on the generated request shapes (the spec does not declare it) but the
 * backend scopes on it, so it rides along as a `queryParams` on every call — exactly what the
 * axios versions passed. The local `./types` stay the source of truth for the payloads: Fern's
 * types under-declare the backend's `extra="allow"` fields.
 */
const scope = (projectId?: string) =>
    projectId ? {queryParams: {project_id: projectId}} : undefined

/**
 * Fern declares `count` and the list fields optional; the local types promise them. Defaulting
 * here is what makes that promise true — a cast alone would hand every consumer that maps over
 * a list an `undefined`. The entities themselves stay `./types`': Fern under-declares the
 * backend's `extra="allow"` fields, so its narrower entity type is the one that is wrong.
 */
const one = (response: {count?: number; subscription?: unknown}): WebhookSubscriptionResponse => ({
    count: response.count ?? 0,
    subscription: response.subscription as WebhookSubscriptionResponse["subscription"],
})

const oneDelivery = (response: {count?: number; delivery?: unknown}): WebhookDeliveryResponse => ({
    count: response.count ?? 0,
    delivery: response.delivery as WebhookDeliveryResponse["delivery"],
})

const manySubscriptions = (response: {
    count?: number
    subscriptions?: unknown[]
}): WebhookSubscriptionsResponse => ({
    count: response.count ?? 0,
    subscriptions: (response.subscriptions ?? []) as WebhookSubscriptionsResponse["subscriptions"],
})

const manyDeliveries = (response: {
    count?: number
    deliveries?: unknown[]
}): WebhookDeliveriesResponse => ({
    count: response.count ?? 0,
    deliveries: (response.deliveries ?? []) as WebhookDeliveriesResponse["deliveries"],
})

const createWebhookSubscription = async (
    data: WebhookSubscriptionCreateRequest,
    projectId?: string,
): Promise<WebhookSubscriptionResponse> =>
    one(await getWebhooksClient().createWebhookSubscription(data, scope(projectId)))

const editWebhookSubscription = async (
    webhookSubscriptionId: string,
    data: WebhookSubscriptionEditRequest,
    projectId?: string,
): Promise<WebhookSubscriptionResponse> =>
    one(
        await getWebhooksClient().editWebhookSubscription(
            {...data, subscription_id: webhookSubscriptionId},
            scope(projectId),
        ),
    )

const deleteWebhookSubscription = async (
    webhookSubscriptionId: string,
    projectId?: string,
): Promise<void> => {
    await getWebhooksClient().deleteWebhookSubscription(
        {subscription_id: webhookSubscriptionId},
        scope(projectId),
    )
}

const queryWebhookSubscriptions = async (
    projectId?: string,
): Promise<WebhookSubscriptionsResponse> =>
    manySubscriptions(await getWebhooksClient().queryWebhookSubscriptions({}, scope(projectId)))

// Lifecycle verbs toggling `flags.is_active` (WP6). Mirror the trigger
// subscription/schedule start/stop routes: POST /subscriptions/{id}/{verb}.
const startWebhookSubscription = async (
    webhookSubscriptionId: string,
    projectId?: string,
): Promise<WebhookSubscriptionResponse> =>
    one(
        await getWebhooksClient().startWebhookSubscription(
            {subscription_id: webhookSubscriptionId},
            scope(projectId),
        ),
    )

const stopWebhookSubscription = async (
    webhookSubscriptionId: string,
    projectId?: string,
): Promise<WebhookSubscriptionResponse> =>
    one(
        await getWebhooksClient().stopWebhookSubscription(
            {subscription_id: webhookSubscriptionId},
            scope(projectId),
        ),
    )

const testWebhookSubscription = async (
    data: WebhookSubscriptionTestRequest,
    projectId?: string,
): Promise<WebhookDeliveryResponse> =>
    oneDelivery(await getWebhooksClient().testWebhookSubscription(data, scope(projectId)))

const queryWebhookDeliveries = async (
    data: WebhookDeliveriesQueryRequest,
    projectId?: string,
): Promise<WebhookDeliveriesResponse> =>
    manyDeliveries(await getWebhooksClient().queryWebhookDeliveries(data, scope(projectId)))

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
