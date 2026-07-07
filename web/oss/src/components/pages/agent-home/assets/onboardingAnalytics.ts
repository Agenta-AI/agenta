/**
 * Implicit "what does the user want their first agent to do?" signal — replaces a survey
 * question with instrumentation on the onboarding paths themselves (template pick, free-text
 * composer submit, browsing away). See `useTemplateSelect`, `useCreateAgent`,
 * `AgentChatPanel.handleCreateAgent`, `OnboardingConfigPanel`, `OnboardingBrowseTemplates`.
 */

/** Minimal shape we need from `usePostHogAg()` — avoids importing the posthog-js types here. */
interface CapturePostHog {
    capture?: (event: string, properties?: Record<string, unknown>) => unknown
}

const MESSAGE_CAPTURE_LIMIT = 500

/** Coarse keyword bucket for a free-text "describe your agent" message. First match wins. */
export function classifyAgentIntent(message: string): string {
    const text = message.toLowerCase()
    if (/support|ticket|helpdesk|customer/.test(text)) return "support"
    if (/research|search|summarize|analyze/.test(text)) return "research"
    if (/workflow|automate|ops|schedule|email|crm/.test(text)) return "ops"
    if (/write|blog|content|marketing|social/.test(text)) return "content"
    if (/code|review|pr|bug|test/.test(text)) return "coding"
    if (/data|sql|report|dashboard/.test(text)) return "data"
    return "other"
}

export type FirstAgentIntentSource = "template" | "composer" | "skipped" | "browse_templates"

export interface FirstAgentIntentPayload {
    source: FirstAgentIntentSource
    /** Extra event properties (template name/category/mode, or the truncated composer message). */
    properties?: Record<string, unknown>
    /** Person property to `$set`; omitted for pure avoidance signals (skipped/browse_templates). */
    intentValue?: string
}

/** Fire-and-forget `first_agent_intent` capture. Null-safe: never throws into the onboarding UX. */
export function captureFirstAgentIntent(
    posthog: CapturePostHog | null | undefined,
    payload: FirstAgentIntentPayload,
): void {
    try {
        const eventProps: Record<string, unknown> = {
            source: payload.source,
            ...payload.properties,
        }
        if (payload.intentValue) {
            eventProps.$set = {first_agent_intent_v1: payload.intentValue}
        }
        posthog?.capture?.("first_agent_intent", eventProps)
    } catch {
        // analytics must never break onboarding
    }
}

/** Truncate a free-text composer message before sending it as an event property. */
export const truncateForCapture = (message: string): string =>
    message.trim().slice(0, MESSAGE_CAPTURE_LIMIT)
