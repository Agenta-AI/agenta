import {useCallback, useState} from "react"

import {templateBuilderMessage, type AgentStarterTemplate} from "@agenta/entities/workflow"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

import {captureFirstAgentIntent} from "../assets/onboardingAnalytics"

import {useCreateAgent} from "./useCreateAgent"

/**
 * Picking a template IS creating the agent: mint it from the template and land in its playground,
 * with the template's builder instruction as the auto-sent first turn. Identical to seeding the
 * create composer from a template and pressing "Create agent" — the surfaces that offer templates
 * (gallery, template detail, the create surface's cards) just skip the composer step.
 *
 * `pendingKey` is the template currently being created, so the clicked card can show a spinner.
 * Create is a multi-step round-trip that ends in navigation, so it only resets on failure.
 */
export function useCreateAgentFromTemplate(surface: "gallery" | "template_detail" | "create") {
    const createAgent = useCreateAgent()
    const posthog = usePostHogAg()
    const [pendingKey, setPendingKey] = useState<string | null>(null)

    const createFromTemplate = useCallback(
        async (template: AgentStarterTemplate) => {
            if (pendingKey) return
            setPendingKey(template.key)
            captureFirstAgentIntent(posthog, {
                source: "template",
                properties: {
                    template: template.name,
                    templateId: template.key,
                    templateCategory: template.category,
                    mode: "builder",
                    surface,
                },
                intentValue: template.category || template.name,
            })
            const ok = await createAgent({
                name: template.name,
                seedMessage: templateBuilderMessage(template),
                autoSendSeed: true,
            })
            if (!ok) setPendingKey(null)
        },
        [createAgent, pendingKey, posthog, surface],
    )

    return {createFromTemplate, pendingKey}
}
