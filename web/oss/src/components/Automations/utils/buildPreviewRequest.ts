import {AutomationFormValues} from "@/oss/services/automations/types"

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
}

/**
 * Builds a dummy event context for the preview, using real IDs when available.
 * Matches the actual payload structure sent by the backend webhook worker.
 */
const buildEventContext = (ctx?: PreviewContext) => ({
    event: {
        event_id: "e44d82b4-...",
        event_type: "environments.revisions.committed",
        timestamp: new Date().toISOString(),
        created_at: new Date().toISOString(),
        attributes: {
            environment_id: "env-123",
            revision_id: "rev-456",
            version: "1.0",
        },
    },
    subscription: {
        id: ctx?.subscriptionId || "<subscription_id>",
        name: "<subscription_name>",
        flags: {is_valid: true},
        tags: [],
        meta: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
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
        headers,
        auth_mode,
        auth_value,
        github_sub_type,
        github_repo,
        github_pat,
        github_workflow,
        github_branch,
    } = formValues

    const eventContext = buildEventContext(ctx)

    if (provider === "webhook") {
        const systemHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            "User-Agent": "Agenta-Webhook/1.0",
            "X-Agenta-Event-Type": "environments.revisions.committed",
            "X-Agenta-Delivery-Id": "<delivery_id>",
            "X-Agenta-Event-Id": "<event_id>",
            "Idempotency-Key": "<delivery_id>",
        }

        if (auth_mode === "authorization") {
            systemHeaders["Authorization"] = auth_value ? "Bearer ••••••••••" : "Bearer <token>"
        } else {
            systemHeaders["X-Agenta-Signature"] = "t=<timestamp>,v1=<signature>"
        }

        // User headers merged after system headers (system headers cannot be overridden)
        const finalHeaders = {...systemHeaders, ...(headers || {})}

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
                Authorization: github_pat ? `Bearer ghp_••••••••••••` : "Bearer <token>",
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
