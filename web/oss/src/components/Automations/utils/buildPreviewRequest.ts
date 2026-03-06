import {AutomationFormValues} from "@/oss/services/automations/types"

import {GITHUB_HEADERS, GITHUB_PAYLOAD_TEMPLATES, GITHUB_URL_TEMPLATES} from "../assets/constants"

export interface PreviewRequest {
    method: "POST"
    url: string
    headers: Record<string, string>
    body: Record<string, unknown>
}

// Dummy UUIDs/timestamps for the preview body
const DUMMY_EVENT_CONTEXT = {
    event_id: "e44d82b4-...",
    event_type: "environments.revisions.committed",
    timestamp: new Date().toISOString(),
    created_at: new Date().toISOString(),
    attributes: {
        environment_id: "env-123",
        revision_id: "rev-456",
        version: "1.0",
    },
}

/**
 * Creates a read-only HTTP request preview for the UI.
 * Masks tokens and resolves basic payload templates so the user sees approximately what will be sent.
 */
export const buildPreviewRequest = (formValues: AutomationFormValues): PreviewRequest => {
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

    if (provider === "webhook") {
        const finalHeaders = {...(headers || {})}

        if (auth_mode === "authorization") {
            finalHeaders["Authorization"] = auth_value ? `Bearer ••••••••••` : "Bearer <token>"
        } else {
            finalHeaders["x-agenta-signature"] = "••••••••••"
        }

        return {
            method: "POST",
            url: url || "https://...",
            headers: finalHeaders,
            body: DUMMY_EVENT_CONTEXT,
        }
    } else if (provider === "github") {
        const subType = github_sub_type || "repository_dispatch"
        const repo = github_repo || "<owner>/<repo>"
        let finalUrl = GITHUB_URL_TEMPLATES[subType].replace("{repo}", repo)
        const payload_fields: Record<string, string> = {...GITHUB_PAYLOAD_TEMPLATES[subType]}

        if (subType === "workflow_dispatch") {
            const workflow = github_workflow || "<workflow.yml>"
            const branch = github_branch || "main"
            finalUrl = finalUrl.replace("{workflow}", workflow)
            payload_fields.ref = payload_fields.ref.replace("{branch}", branch)
        }

        // Mock the resolved payload_fields (this logic is typically backend-side)
        const mockResolvedPayload: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(payload_fields)) {
            if (value === "$") {
                mockResolvedPayload[key] = DUMMY_EVENT_CONTEXT
            } else if (value === "$.event.event_type" || value === "$.event_type") {
                mockResolvedPayload[key] = DUMMY_EVENT_CONTEXT.event_type
            } else {
                mockResolvedPayload[key] = value
            }
        }

        return {
            method: "POST",
            url: finalUrl,
            headers: {
                ...GITHUB_HEADERS,
                Authorization: github_pat ? `Bearer ghp_••••••••••••` : "Bearer <token>",
            },
            body: mockResolvedPayload,
        }
    }

    return {
        method: "POST",
        url: "",
        headers: {},
        body: {},
    }
}
