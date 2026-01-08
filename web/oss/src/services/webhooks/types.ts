/**
 * Webhook types for post-deployment webhooks
 */

export type WebhookType = "http_webhook" | "python_script"

export interface EnvironmentVariable {
    key: string
    value: string
    is_secret: boolean
}

export interface HttpHeader {
    key: string
    value: string
    is_secret: boolean
}

export interface Webhook {
    id: string
    project_id: string
    app_id: string | null
    name: string
    description: string | null
    webhook_type: WebhookType
    is_enabled: boolean

    // HTTP Webhook fields
    webhook_url: string | null
    webhook_method: string | null
    webhook_headers: HttpHeader[]
    webhook_body_template: string | null

    // Python Script fields
    script_timeout: number | null
    docker_image: string | null

    // Common fields
    environment_variables: EnvironmentVariable[]
    retry_on_failure: boolean
    max_retries: number
    retry_delay_seconds: number
    trigger_on_environments: string[]
    created_at: string
    updated_at: string
}

export interface WebhookExecution {
    id: string
    webhook_id: string
    deployment_id: string | null
    environment_name: string
    variant_id: string | null
    variant_revision_id: string | null
    status: "pending" | "running" | "success" | "failed" | "timeout"
    started_at: string | null
    completed_at: string | null
    exit_code: number | null
    output: string | null
    error_output: string | null
    container_id: string | null
    retry_count: number
    is_retry: boolean
    parent_execution_id: string | null
    created_at: string
}

export interface CreateWebhookPayload {
    project_id: string
    app_id?: string | null
    name: string
    description?: string
    webhook_type: WebhookType

    // HTTP Webhook fields
    webhook_url?: string
    webhook_method?: string
    webhook_headers?: HttpHeader[]
    webhook_body_template?: string

    // Python Script fields
    script_content?: string
    script_timeout?: number
    docker_image?: string

    // Common fields
    environment_variables?: EnvironmentVariable[]
    retry_on_failure?: boolean
    max_retries?: number
    retry_delay_seconds?: number
    trigger_on_environments?: string[]
    is_enabled?: boolean
}

export interface UpdateWebhookPayload {
    project_id?: string
    app_id?: string | null
    name?: string
    description?: string
    webhook_type?: WebhookType

    // HTTP Webhook fields
    webhook_url?: string
    webhook_method?: string
    webhook_headers?: HttpHeader[]
    webhook_body_template?: string

    // Python Script fields
    script_content?: string
    script_timeout?: number
    docker_image?: string

    // Common fields
    environment_variables?: EnvironmentVariable[]
    retry_on_failure?: boolean
    max_retries?: number
    retry_delay_seconds?: number
    trigger_on_environments?: string[]
    is_enabled?: boolean
}
