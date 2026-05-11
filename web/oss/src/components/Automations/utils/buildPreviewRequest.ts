import {AutomationFormValues, WebhookEventType} from "@/oss/services/automations/types"

import {GITHUB_HEADERS, GITHUB_PAYLOAD_TEMPLATES, GITHUB_URL_TEMPLATES} from "../assets/constants"

export interface PreviewRequest {
    method: "POST"
    url: string
    headers: Record<string, string>
    body: Record<string, unknown>
}

export interface PreviewContext {
    projectId?: string
    subscriptionId?: string
    userId?: string
}

/**
 * Builds example event attributes for an environment deployment.
 */
const buildCommittedEnvironmentAttributes = (ctx?: PreviewContext) => ({
    user_id: ctx?.userId || "<user_id>",
    references: {
        environment: {
            id: "019c2b74-d84f-7cf2-aff0-e45e116e26cb",
        },
        environment_variant: {
            id: "019c2b74-d85c-7803-8a55-f12f2fc8f461",
        },
        environment_revision: {
            id: "019cd9b8-e21c-7c73-82a2-099cb1352f19",
            slug: "prod-0008",
            version: "8",
        },
    },
    state: {
        references: {
            "customer-support-bot.revision": {
                application: {
                    id: "019c2b74-d8b7-74e7-9f16-6a6a2c9cd111",
                    slug: "customer-support-bot",
                },
                application_variant: {
                    id: "019c2b74-d8df-7f57-bb13-5e8c0c3f5222",
                    slug: "production",
                },
                application_revision: {
                    id: "019cd9b8-e21c-7c73-82a2-099cb1352f19",
                    slug: "prompt-v8",
                    version: "8",
                },
            },
        },
    },
    diff: {
        created: {},
        updated: {
            "customer-support-bot.revision": {
                old: {
                    application: {
                        id: "019c2b74-d8b7-74e7-9f16-6a6a2c9cd111",
                        slug: "customer-support-bot",
                    },
                    application_variant: {
                        id: "019c2b74-d8df-7f57-bb13-5e8c0c3f5222",
                        slug: "production",
                    },
                    application_revision: {
                        id: "019cd9a1-3fd6-7144-9c0d-fcbf0a6fd777",
                        slug: "prompt-v7",
                        version: "7",
                    },
                },
                new: {
                    application: {
                        id: "019c2b74-d8b7-74e7-9f16-6a6a2c9cd111",
                        slug: "customer-support-bot",
                    },
                    application_variant: {
                        id: "019c2b74-d8df-7f57-bb13-5e8c0c3f5222",
                        slug: "production",
                    },
                    application_revision: {
                        id: "019cd9b8-e21c-7c73-82a2-099cb1352f19",
                        slug: "prompt-v8",
                        version: "8",
                    },
                },
            },
        },
        deleted: {},
    },
})

const buildEventContext = (eventType: string, ctx?: PreviewContext) => {
    const timestamp = new Date().toISOString()

    if (eventType === "webhooks.subscriptions.tested") {
        return {
            event: {
                event_id: "01961234-5678-7abc-9def-123456789abc",
                event_type: eventType,
                timestamp,
                created_at: timestamp,
                attributes: {
                    subscription_id: ctx?.subscriptionId || "draft",
                },
            },
            subscription: {
                id: ctx?.subscriptionId || "draft",
            },
            scope: {
                project_id: ctx?.projectId || "<project_id>",
            },
        }
    }

    return {
        event: {
            event_id: "01961234-5678-7abc-9def-123456789abc",
            event_type: eventType,
            timestamp,
            created_at: timestamp,
            attributes: buildCommittedEnvironmentAttributes(ctx),
        },
        subscription: {
            id: ctx?.subscriptionId || "<subscription_id>",
        },
        scope: {
            project_id: ctx?.projectId || "<project_id>",
        },
    }
}

/**
 * Recursively resolves template strings in a payload object.
 */
const resolvePayloadMocks = (payload: any, eventContext: Record<string, any>): any => {
    if (typeof payload === "string") {
        if (payload === "$") return eventContext
        if (payload.startsWith("$.")) {
            const path = payload.slice(2) // strip "$."
            const parts = path.split(".")
            let current: any = eventContext
            for (const part of parts) {
                if (current && typeof current === "object" && part in current) {
                    current = current[part]
                } else {
                    return payload
                }
            }
            return current
        }
        return payload
    }

    if (typeof payload === "object" && payload !== null) {
        const resolved: any = Array.isArray(payload) ? [] : {}
        for (const [key, value] of Object.entries(payload)) {
            resolved[key] = resolvePayloadMocks(value, eventContext)
        }
        return resolved
    }

    return payload
}

/**
 * Creates a read-only HTTP request preview for the UI.
 * Masks tokens and resolves payload templates so the user sees what Agenta sends.
 */
export const buildPreviewRequest = (
    formValues: AutomationFormValues,
    ctx?: PreviewContext,
): PreviewRequest => {
    const {
        provider,
        url,
        auth_mode,
        auth_value,
        github_sub_type,
        github_repo,
        github_pat,
        github_workflow,
        github_branch,
    } = formValues

    // Form stores headers as header_list (array of {key, value}), convert to Record
    const headerList = (formValues as any).header_list as {key: string; value: string}[] | undefined
    const customHeaders: Record<string, string> = {}
    if (headerList) {
        for (const h of headerList) {
            if (h.key && h.value) customHeaders[h.key] = h.value
        }
    }

    // Form uses field name "events", not "event_types"
    const events = (formValues as any).events as WebhookEventType[] | undefined
    const selectedEvent: WebhookEventType = events?.[0] || "environments.revisions.committed"
    const eventContext = buildEventContext(selectedEvent, ctx)
    const previewEventId = eventContext.event.event_id
    const previewDeliveryId = "01961234-delivery-7abc-..."

    const buildSystemHeaders = (authHeader: Record<string, string>) => ({
        "Content-Type": "application/json",
        "User-Agent": "Agenta-Webhook/1.0",
        "X-Agenta-Event-Type": selectedEvent,
        "X-Agenta-Delivery-Id": previewDeliveryId,
        "X-Agenta-Event-Id": previewEventId,
        "Idempotency-Key": previewDeliveryId,
        ...authHeader,
    })

    if (provider === "webhook") {
        const previewHeaders: Record<string, string> = buildSystemHeaders(
            auth_mode === "authorization"
                ? {
                      Authorization: auth_value ? "••••••••••" : "<secret>",
                  }
                : {
                      "X-Agenta-Signature": "t=<unix_ts>,v1=<hex_hmac>",
                  },
        )

        const finalHeaders = {
            ...customHeaders,
            ...previewHeaders,
        }

        return {
            method: "POST",
            url: url || "https://...",
            headers: finalHeaders,
            body: eventContext,
        }
    } else if (provider === "github") {
        const subType = github_sub_type || "repository_dispatch"
        const repo = github_repo || "<owner>/<repo>"
        let finalUrl = GITHUB_URL_TEMPLATES[subType].replace("{repo}", repo)
        const payload_fields = {...GITHUB_PAYLOAD_TEMPLATES[subType]}

        if (subType === "workflow_dispatch") {
            const workflow = github_workflow || "<workflow.yml>"
            const branch = github_branch || "main"
            finalUrl = finalUrl.replace("{workflow}", workflow)
            if (typeof payload_fields.ref === "string") {
                payload_fields.ref = payload_fields.ref.replace("{branch}", branch)
            }
        }

        return {
            method: "POST",
            url: finalUrl,
            headers: {
                ...GITHUB_HEADERS,
                ...buildSystemHeaders({
                    Authorization: github_pat ? "Bearer ghp_••••••••" : "Bearer <token>",
                }),
            },
            body: resolvePayloadMocks(payload_fields, eventContext),
        }
    }

    return {
        method: "POST",
        url: "",
        headers: {},
        body: {},
    }
}
