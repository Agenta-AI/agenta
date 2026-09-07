import {useCallback, useEffect, useMemo, useState, type ReactNode} from "react"

import {
    type TriggerScheduleEdit,
    type TriggerSubscriptionEdit,
} from "@agenta/entities/gatewayTrigger"
import {
    agentWorkflowsListQueryStateAtom,
    workflowVariantsListQueryStateAtomFamily,
    type Workflow,
} from "@agenta/entities/workflow"
import {
    buildTriggerReferences,
    EMPTY_BINDING,
    parseStoredBinding,
} from "@agenta/entity-ui/gatewayTrigger"
import {Check, Robot} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {Skeleton} from "@/components/ui/skeleton"

import {buildAutomationEdit} from "../automationEdit"
import type {Automation} from "../automationModel"
import {useAutomation} from "../useAutomation"

import {PickerOverlay} from "./PickerOverlay"

/**
 * Which agent this automation runs.
 *
 * Rebinding is not "write an id": the backend stores the agent as a `data.references` FAMILY
 * (`application_*` or the parallel `workflow_*` an SDK-created trigger uses) and rejects a payload
 * that populates both, and "latest" means binding the agent's VARIANT so the newest revision is
 * resolved at run time. Both rules already live in `buildTriggerReferences`, so this reuses it
 * rather than assembling references by hand and silently writing an unresolvable binding.
 *
 * That is why the save is deferred: the chosen agent's variant list has to land first. The pick
 * parks the id in `pendingAgentId`, the variants query resolves, and the effect writes once.
 */
export const AgentPicker = ({
    automation,
    trigger,
}: {
    automation: Automation
    trigger: ReactNode
}) => {
    const [open, setOpen] = useState(false)
    const [pendingAgentId, setPendingAgentId] = useState<string | null>(null)

    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agents = useMemo<Workflow[]>(() => agentsQuery.data ?? [], [agentsQuery.data])

    // Keyed on "" while nothing is pending, which is how this family stays inert.
    const variants = useAtomValue(workflowVariantsListQueryStateAtomFamily(pendingAgentId ?? ""))
    const {edit} = useAutomation(automation.id, automation.kind)

    useEffect(() => {
        if (!pendingAgentId || variants.isPending) return
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

    const pick = useCallback(
        (agentId: string) => {
            setOpen(false)
            if (agentId === automation.agentId) return
            setPendingAgentId(agentId)
        },
        [automation.agentId],
    )

    return (
        <PickerOverlay
            open={open}
            onOpenChange={setOpen}
            title="Run which agent?"
            trigger={trigger}
            contentClassName="w-[320px]"
        >
            {/* Capped and scrolled: a project with fifty agents must not grow the popover, and
                the sheet's own height is the viewport's, not the list's. */}
            <div className="max-h-[320px] min-h-0 overflow-y-auto p-1 pb-3 lg:pb-1">
                {agentsQuery.isPending ? (
                    // Row geometry, not a spinner — the list replaces this without shifting.
                    <div className="flex flex-col gap-1 p-1">
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-4/5" />
                        <Skeleton className="h-8 w-3/5" />
                    </div>
                ) : agents.length === 0 ? (
                    <p className="text-muted-foreground m-0 px-3 py-6 text-center text-xs">
                        No agents in this project yet.
                    </p>
                ) : (
                    agents.map((agent) => {
                        const id = agent.id
                        if (!id) return null
                        const bound = id === automation.agentId
                        return (
                            <button
                                key={id}
                                type="button"
                                onClick={() => pick(id)}
                                aria-current={bound || undefined}
                                className="hover:bg-accent flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 py-2 text-left"
                            >
                                <Robot
                                    aria-hidden
                                    size={16}
                                    className="text-muted-foreground shrink-0"
                                />
                                <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                                    {agent.name?.trim() || agent.slug?.trim() || "Untitled agent"}
                                </span>
                                {bound ? (
                                    <Check
                                        aria-label="Currently bound"
                                        size={14}
                                        className="text-primary shrink-0"
                                    />
                                ) : null}
                            </button>
                        )
                    })
                )}
            </div>
        </PickerOverlay>
    )
}
