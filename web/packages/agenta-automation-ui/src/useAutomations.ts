import {useCallback, useMemo} from "react"

import {useTriggerSchedules, useTriggerSubscriptions} from "@agenta/entities/gatewayTrigger"
import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

import {toAutomation, type Automation} from "./automationModel"

/**
 * The automations list — both trigger endpoints merged into one, newest first.
 *
 * Same merge the agent overview's next-triggers section does: two independent queries, one
 * ordering. `search` filters the resolved rows in place (name, description, agent name) rather
 * than refetching — neither endpoint takes a text query, and both lists are already client-side.
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

    const automations = useMemo<Automation[]>(() => {
        const merged = [
            ...schedules.map((schedule) => toAutomation(schedule, "schedule")),
            ...subscriptions.map((subscription) => toAutomation(subscription, "event")),
        ].sort((a, b) => (b.raw.created_at ?? "").localeCompare(a.raw.created_at ?? ""))

        const term = search?.trim().toLowerCase()
        if (!term) return merged
        return merged.filter((automation) =>
            [
                automation.name,
                automation.description,
                agentNames.get(automation.agentId ?? "") ?? "",
            ].some((field) => field.toLowerCase().includes(term)),
        )
    }, [agentNames, schedules, search, subscriptions])

    const refetch = useCallback(() => {
        void refetchSchedules()
        void refetchSubscriptions()
    }, [refetchSchedules, refetchSubscriptions])

    return {
        automations,
        isLoading: schedulesLoading || subscriptionsLoading,
        error: schedulesError ?? subscriptionsError,
        refetch,
    }
}
