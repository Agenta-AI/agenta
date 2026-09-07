import {useCallback, useEffect, useState} from "react"

import {
    type TriggerScheduleEdit,
    type TriggerSubscriptionEdit,
} from "@agenta/entities/gatewayTrigger"
import {workflowVariantsListQueryStateAtomFamily} from "@agenta/entities/workflow"
import {
    buildTriggerReferences,
    EMPTY_BINDING,
    parseStoredBinding,
} from "@agenta/entity-ui/gatewayTrigger"
import {useAtomValue} from "jotai"

import {buildAutomationEdit} from "./automationEdit"
import type {Automation} from "./automationModel"
import {useAutomation} from "./useAutomation"

/**
 * Rebinding a saved automation to another agent.
 *
 * Not "write an id": the backend stores the agent as a `data.references` FAMILY (`application_*`
 * or the parallel `workflow_*` an SDK-created trigger uses) and rejects a payload that populates
 * both, and "latest" means binding the agent's VARIANT so the newest revision is resolved at run
 * time. Both rules already live in `buildTriggerReferences`, so this reuses it rather than
 * assembling references by hand and silently writing an unresolvable binding.
 *
 * That is why the save is deferred: the chosen agent's variant list has to land first. The pick
 * parks the id in `pendingAgentId`, the variants query resolves, and the effect writes once.
 *
 * Inert without an automation — a draft has no row to PUT to and reports its pick to its host
 * instead (see `AutomationAgentField`'s `onSelectAgent`).
 */
export const useAgentBinding = (automation?: Automation) => {
    const [pendingAgentId, setPendingAgentId] = useState<string | null>(null)

    // Keyed on "" while nothing is pending, which is how this family stays inert.
    const variants = useAtomValue(workflowVariantsListQueryStateAtomFamily(pendingAgentId ?? ""))
    const {edit} = useAutomation(automation?.id, automation?.kind ?? "schedule")

    useEffect(() => {
        if (!automation || !pendingAgentId || variants.isPending) return
        // Cleared before the write, so a refetch of `automation` can never replay the save.
        setPendingAgentId(null)

        const stored = automation.raw.data?.references
        const family = (stored ? parseStoredBinding(stored) : EMPTY_BINDING).family
        // An agent with exactly one variant binds it; more than one is ambiguous, and the
        // artifact-only reference the builder then writes is what the desktop writes too.
        const only = variants.data.length === 1 ? variants.data[0] : null
        const references = buildTriggerReferences(
            {
                mode: "latest",
                workflowId: pendingAgentId,
                variantId: only?.id ?? null,
                revisionId: null,
                family,
            },
            stored,
        )

        // `buildAutomationEdit` re-sends every field the PUT would otherwise clear; only
        // `data.references` is ours to change, and the union is narrowed per kind so the two
        // payload shapes never blur into one.
        if (automation.kind === "schedule") {
            const body = buildAutomationEdit(automation, {}) as TriggerScheduleEdit
            void edit({...body, data: {...body.data, references}})
        } else {
            const body = buildAutomationEdit(automation, {}) as TriggerSubscriptionEdit
            void edit({...body, data: {...body.data, references}})
        }
    }, [pendingAgentId, variants, automation, edit])

    return useCallback(
        (agentId: string) => {
            if (!automation || agentId === automation.agentId) return
            setPendingAgentId(agentId)
        },
        [automation],
    )
}
