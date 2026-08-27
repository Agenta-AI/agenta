import {useCallback} from "react"

import {agentTemplateSeed, type AgentStarterTemplate} from "@agenta/entities/workflow"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

import {TEMPLATE_BUILDER_MODE} from "../assets/constants"
import {captureFirstAgentIntent} from "../assets/onboardingAnalytics"

import {useCreateAgent} from "./useCreateAgent"

/**
 * What happens when a template card is clicked, gated by `NEXT_PUBLIC_AGENT_TEMPLATE_BUILDER`
 * ({@link TEMPLATE_BUILDER_MODE}):
 *  - Builder mode ON (default) → create a blank agent and open its playground seeded with the
 *    template's builder instruction (Mahmoud's agent-builder flow — no config-review drawer, no
 *    direct config write). Reuses the same first-run seed path as the Home composer.
 *  - Builder mode OFF (explicit `"false"`) → the existing config-definition flow: hand the template to
 *    `openSetup` so the caller opens the `TemplateSetupDrawer`.
 *
 * Both behaviors are retained so they can be A/B'd while the agent builder is unreliable.
 *
 * @param openSetup Caller's "open the setup drawer" action (used only when builder mode is OFF).
 */
export function useTemplateSelect(openSetup: (template: AgentStarterTemplate) => void) {
    const createAgent = useCreateAgent()
    const posthog = usePostHogAg()

    return useCallback(
        (template: AgentStarterTemplate) => {
            if (TEMPLATE_BUILDER_MODE) {
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
                void createAgent(agentTemplateSeed(template))
                return
            }
            captureFirstAgentIntent(posthog, {
                source: "template",
                properties: {
                    template: template.name,
                    templateId: template.key,
                    templateCategory: template.category,
                    mode: "setup",
                },
                intentValue: template.category || template.name,
            })
            openSetup(template)
        },
        [createAgent, openSetup, posthog],
    )
}
