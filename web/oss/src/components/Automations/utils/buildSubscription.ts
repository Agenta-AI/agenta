import {
    AutomationFormValues,
    WebhookSubscriptionCreateRequest,
    WebhookSubscriptionEditRequest,
} from "@/oss/services/automations/types"

import {GITHUB_HEADERS, GITHUB_PAYLOAD_TEMPLATES, GITHUB_URL_TEMPLATES} from "../assets/constants"

/**
 * Transforms form values into the backend subscription shape per provider.
 */
export const buildSubscription = (
    formValues: AutomationFormValues,
    isEdit: boolean,
    subscriptionId?: string,
): WebhookSubscriptionCreateRequest | WebhookSubscriptionEditRequest => {
    const {
        provider,
        name,
        event_types,
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

    // Common data
    const baseSubscription = {
        name,
        ...(isEdit && {id: subscriptionId}),
    }

    if (provider === "webhook") {
        const subscription: WebhookSubscriptionCreateRequest["subscription"] = {
            ...baseSubscription,
            data: {
                url: url || "",
                event_types,
                headers: headers || undefined,
                auth_mode: auth_mode || "signature",
            },
        }

        // Add secret for new or if changed in edit
        if (auth_mode === "authorization" && auth_value) {
            subscription.secret = auth_value
        }

        return {subscription}
    } else if (provider === "github") {
        const subType = github_sub_type || "repository_dispatch"
        const repo = github_repo || ""
        let finalUrl = GITHUB_URL_TEMPLATES[subType].replace("{repo}", repo)
        const payload_fields: Record<string, unknown> = structuredClone(
            GITHUB_PAYLOAD_TEMPLATES[subType],
        )

        if (subType === "workflow_dispatch") {
            const workflow = github_workflow || ""
            const branch = github_branch || "main"
            finalUrl = finalUrl.replace("{workflow}", workflow)
            payload_fields.ref = (payload_fields.ref as string).replace("{branch}", branch)
        }

        const subscription: WebhookSubscriptionCreateRequest["subscription"] = {
            ...baseSubscription,
            data: {
                url: finalUrl,
                event_types,
                headers: GITHUB_HEADERS,
                auth_mode: "authorization",
                payload_fields,
            },
        }

        // Add secret for new or if changed in edit
        if (github_pat) {
            subscription.secret = github_pat.startsWith("Bearer ")
                ? github_pat
                : `Bearer ${github_pat}`
        }

        return {subscription}
    }

    throw new Error(`Unknown provider: ${provider}`)
}
