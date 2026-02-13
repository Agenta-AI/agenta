export interface WebhookSubscription {
    id: string
    name: string
    url: string
    events: string[]
    is_active: boolean
    created_at: string
    updated_at: string
}

export interface CreateWebhookSubscription {
    name: string
    url: string
    events: string[]
    is_active?: boolean
}

export interface UpdateWebhookSubscription {
    name?: string
    url?: string
    events?: string[]
    is_active?: boolean
}

export interface TestWebhookResponse {
    success: boolean
    status_code: number | null
    response_body: string | null
    duration_ms: number
    test_secret: string
    signature_format: string
    signing_payload?: string
}
