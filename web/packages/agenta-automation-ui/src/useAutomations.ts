import {useCallback, useMemo} from "react"

import {
    useTriggerSchedules,
    useTriggerSubscriptions,
    type TriggerSchedule,
    type TriggerSubscription,
} from "@agenta/entities/gatewayTrigger"
import {
    agentWorkflowsListQueryStateAtom,
    workflowQueryAtomFamily,
    workflowRevisionRefsByVariantAtomFamily,
    workflowRevisionsQueryAtomFamily,
    type Workflow,
} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"

import {agentBindingLookup, toAutomation, type Automation} from "./automationModel"

/**
 * The automations list — both trigger endpoints merged into one, newest first.
 *
 * Same merge the agent overview's next-triggers section does: two independent queries, one
 * ordering. `search` filters the resolved rows in place (name, description, agent name) rather
 * than refetching — neither endpoint takes a text query, and both lists are already client-side.
 *
 * Every `agentId` here is the agent's WORKFLOW id, even when the trigger binds only a variant or
 * a revision — the leaf id is resolved to its workflow before anything reads the row, so the
 * label, the search, the agent filter and the agent grouping all key the same roster.
 */
export const useAutomations = (search?: string) => {
    const {
        schedules,
        isLoading: schedulesLoading,
        error: schedulesError,
        refetch: refetchSchedules,
    } = useTriggerSchedules()
    const {
        subscriptions,
        isLoading: subscriptionsLoading,
        error: subscriptionsError,
        refetch: refetchSubscriptions,
    } = useTriggerSubscriptions()
    // Agent names are the third thing people search by; the roster query is already warm from
    // the nav rail, so reading it here costs nothing.
    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agentNames = useMemo(
        () =>
            new Map(
                (agentsQuery.data ?? []).map((agent: Workflow) => [
                    agent.id,
                    agent.name || agent.slug || "",
                ]),
            ),
        [agentsQuery.data],
    )

    const {resolveAgentId, pending: bindingsPending} = useBoundAgentIds(schedules, subscriptions)

    const automations = useMemo<Automation[]>(() => {
        const merged = [
            ...schedules.map((schedule) => toAutomation(schedule, "schedule")),
            ...subscriptions.map((subscription) => toAutomation(subscription, "event")),
        ]
            // A binding still resolving keeps its leaf id: the row is gated blank by `agentsReady`
            // until the workflow id arrives, so the leaf id is never read as an agent.
            .map((automation) => ({
                ...automation,
                agentId: resolveAgentId(automation.agentId) ?? automation.agentId,
            }))
            .sort((a, b) => (b.raw.created_at ?? "").localeCompare(a.raw.created_at ?? ""))

        const term = search?.trim().toLowerCase()
        if (!term) return merged
        return merged.filter((automation) =>
            [
                automation.name,
                automation.description,
                agentNames.get(automation.agentId ?? "") ?? "",
            ].some((field) => field.toLowerCase().includes(term)),
        )
    }, [agentNames, resolveAgentId, schedules, search, subscriptions])

    const refetch = useCallback(() => {
        void refetchSchedules()
        void refetchSubscriptions()
    }, [refetchSchedules, refetchSubscriptions])

    return {
        automations,
        isLoading: schedulesLoading || subscriptionsLoading,
        error: schedulesError ?? subscriptionsError,
        refetch,
        agentNames,
        /** False until every row's agent can be named — a binding still resolving is not unknown. */
        agentsReady: !agentsQuery.isPending && !bindingsPending,
        /**
         * The workflow id behind a bound id; the id itself when it needs no lookup or resolves
         * to nothing; null while its lookup is pending or failed — an id that cannot be trusted.
         */
        resolveAgentId,
    }
}

/**
 * Workflow ids for the triggers that bind a variant or a revision instead of the agent itself.
 *
 * Read through the workflow entity's own per-id queries — a variant's revision list names its
 * revisions, and a revision names its workflow — so nothing here is fetched twice, and a
 * revision the list already primed costs no request at all. Unresolved ids are few (the UI
 * always writes the artifact), so one read per id is the right size.
 */
function useBoundAgentIds(schedules: TriggerSchedule[], subscriptions: TriggerSubscription[]) {
    const lookups = useMemo(() => {
        const byId = new Map<string, {kind: "variant" | "revision"; id: string}>()
        for (const trigger of [...schedules, ...subscriptions]) {
            const lookup = agentBindingLookup(trigger.data?.references)
            if (lookup) byId.set(lookup.id, lookup)
        }
        return byId
    }, [schedules, subscriptions])

    // `ids` holds only SETTLED lookups: a workflow id, or null for a binding that names nothing.
    // A pending or failed lookup stays absent, so a transport error can never read as "this
    // variant is the agent" — that leaf id would seed the editor's draft and be written back as
    // the agent on the next Save.
    const resolvedAtom = useMemo(
        () =>
            atom((get) => {
                const ids = new Map<string, string | null>()
                let pending = false
                for (const {kind, id} of lookups.values()) {
                    let revisionId: string | null = id
                    if (kind === "variant") {
                        const query = get(workflowRevisionsQueryAtomFamily(id))
                        if (query.isPending) pending = true
                        if (query.isPending || query.isError) continue
                        // Newest first; any revision of the variant names the same workflow.
                        revisionId = get(workflowRevisionRefsByVariantAtomFamily(id))[0]?.id ?? null
                        if (!revisionId) {
                            ids.set(id, null)
                            continue
                        }
                    }
                    const revision = get(workflowQueryAtomFamily(revisionId))
                    if (revision.isPending) pending = true
                    if (revision.isPending || revision.isError) continue
                    ids.set(id, revision.data?.workflow_id ?? null)
                }
                return {ids, pending}
            }),
        [lookups],
    )
    const resolved = useAtomValue(resolvedAtom)

    const resolveAgentId = useCallback(
        (agentId: string | null): string | null => {
            if (!agentId || !lookups.has(agentId)) return agentId
            if (!resolved.ids.has(agentId)) return null
            return resolved.ids.get(agentId) || agentId
        },
        [lookups, resolved.ids],
    )

    return {resolveAgentId, pending: resolved.pending}
}
