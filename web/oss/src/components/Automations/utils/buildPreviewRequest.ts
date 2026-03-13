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
 * Builds a dummy event context that mirrors the resolver input on the backend.
 *
 * GitHub payload templates resolve against this full context ($.event.*,
 * $.subscription.*, $.scope.*). The plain webhook provider currently sends
 * event.attributes as the body.
 */
const buildEventContext = (eventType: string, ctx?: PreviewContext) => ({
    event: {
        event_id: "01961234-5678-7abc-...",
        event_type: eventType,
        timestamp: new Date().toISOString(),
        created_at: new Date().toISOString(),
        attributes: {
            user_id: ctx?.userId || "<user_id>",
            references: {
                environment: {
                    id: "<environment_id>",
                },
                environment_variant: {
                    id: "<environment_variant_id>",
                },
                environment_revision: {
                    id: "<environment_revision_id>",
                    slug: "<slug>",
                    version: "<version>",
                },
            },
        },
    },
    subscription: {
        id: ctx?.subscriptionId || "<subscription_id>",
    },
    scope: {
        project_id: ctx?.projectId || "<project_id>",
    },
})

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
 * Masks tokens and resolves basic payload templates so the user sees approximately what will be sent.
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
                      Authorization: auth_value ? "Bearer ••••••••••" : "Bearer <token>",
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
            body: eventContext.event.attributes,
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
