import {useCallback} from "react"

import {TEMPLATE_BUILDER_MODE} from "../assets/constants"
import {type AgentTemplate, templateBuilderMessage} from "../assets/templates"

import {useCreateAgent} from "./useCreateAgent"

/**
 * What happens when a template card is clicked, gated by `NEXT_PUBLIC_AGENT_TEMPLATE_BUILDER`
 * ({@link TEMPLATE_BUILDER_MODE}):
 *  - Builder mode ON  → create a blank agent and open its playground seeded with the template's
 *    builder instruction (Mahmoud's agent-builder flow — no config-review drawer, no direct config
 *    write). Reuses the same first-run seed path as the Home composer.
 *  - Builder mode OFF (default) → the existing config-definition flow: hand the template to
 *    `openSetup` so the caller opens the `TemplateSetupDrawer`.
 *
 * Both behaviors are retained so they can be A/B'd while the agent builder is unreliable.
 *
 * @param openSetup Caller's "open the setup drawer" action (used only when builder mode is OFF).
 */
export function useTemplateSelect(openSetup: (template: AgentTemplate) => void) {
    const createAgent = useCreateAgent()

    return useCallback(
        (template: AgentTemplate) => {
            if (TEMPLATE_BUILDER_MODE) {
                void createAgent({
                    name: template.name,
                    seedMessage: templateBuilderMessage(template),
                })
                return
            }
            openSetup(template)
        },
        [createAgent, openSetup],
    )
}
