import {useCallback} from "react"

import {agentTemplateSeed, type AgentStarterTemplate} from "@agenta/entities/workflow"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

import {captureFirstAgentIntent} from "../assets/onboardingAnalytics"

import {useCreateAgent} from "./useCreateAgent"

/**
 * What happens when a template card is clicked: create a blank agent and open its playground
 * seeded with the template's builder instruction (the agent-builder flow — no config-review
 * drawer, no direct config write). Reuses the same first-run seed path as the Home composer.
 */
export function useTemplateSelect() {
    const createAgent = useCreateAgent()
    const posthog = usePostHogAg()

    return useCallback(
        (template: AgentStarterTemplate) => {
            captureFirstAgentIntent(posthog, {
                source: "template",
                properties: {
                    template: template.name,
                    templateId: template.key,
                    templateCategory: template.category,
                    mode: "builder",
                },
                intentValue: template.category || template.name,
            })
            // What the pick MEANS is shared (name + builder instruction); this app only
            // decides where the seed is delivered.
            void createAgent({...agentTemplateSeed(template), template})
        },
        [createAgent, posthog],
    )
}
