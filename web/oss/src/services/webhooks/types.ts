// Mirror of api/oss/src/core/webhooks/types.py
// IMPORTANT: Do not add fields that don't exist in the backend.

// --- EVENT TYPES ----------------------------------------------------------- //

export type WebhookEventType = "environments.revisions.committed" | "webhooks.subscriptions.tested"

// --- SUBSCRIPTION SHAPES --------------------------------------------------- //

export interface WebhookSubscriptionData {
    url: string
    headers?: Record<string, string>
    event_types?: WebhookEventType[]
}

export interface WebhookSubscriptionFlags {
    is_valid?: boolean
}

/** Full subscription as returned by the backend */
export interface WebhookSubscription {
    id: string
    slug?: string
    name?: string
    description?: string
    created_at: string
    updated_at: string
    flags?: WebhookSubscriptionFlags
    data: WebhookSubscriptionData
    secret?: string
}

// --- REQUEST BODIES -------------------------------------------------------- //

/** POST /api/webhooks/ */
export interface WebhookSubscriptionCreateRequest {
    subscription: {
        name?: string
        description?: string
        flags?: Pick<WebhookSubscriptionFlags, "is_valid">
        data: {
            url: string
            event_types?: WebhookEventType[]
            headers?: Record<string, string>
        }
    }
}

/** PUT /api/webhooks/{subscription_id}
 *  subscription.id MUST match the path param.
 */
export interface WebhookSubscriptionEditRequest {
    subscription: {
        id: string
        name?: string
        description?: string
        flags?: Pick<WebhookSubscriptionFlags, "is_valid">
        data: {
            url: string
            event_types?: WebhookEventType[]
            headers?: Record<string, string>
        }
    }
}

// --- RESPONSE SHAPES ------------------------------------------------------- //

export interface WebhookSubscriptionResponse {
    count: number
    subscription?: WebhookSubscription
}

export interface WebhookSubscriptionsResponse {
    count: number
    subscriptions: WebhookSubscription[]
}

// --- DELIVERY SHAPES ------------------------------------------------------- //

export interface WebhookDeliveryResponseInfo {
    status_code?: number
    body?: string
}

export interface WebhookDeliveryData {
    event_type?: WebhookEventType
    url: string
    headers?: Record<string, string>
    response?: WebhookDeliveryResponseInfo
    error?: string
}

export interface WebhookDeliveryStatus {
    message?: string
    type?: string
    code?: string
}

export interface WebhookDelivery {
    id: string
    status: WebhookDeliveryStatus
    data?: WebhookDeliveryData
    subscription_id: string
    event_id: string
    created_at: string
    updated_at: string
}

export interface WebhookDeliveryResponse {
    count: number
    delivery?: WebhookDelivery
}

export interface WebhookDeliveriesResponse {
    count: number
    deliveries: WebhookDelivery[]
}
