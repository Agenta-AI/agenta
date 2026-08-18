import type {SessionStream} from "@agenta/entities/session"
import type {ListQueryState} from "@agenta/entities/shared"
import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {sessionAgentId} from "@agenta/sessions/row"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"

import {localAgentActivityAtom} from "@/oss/components/AgentChatSlice/state/sessions"

import {sidebarSessionRowsAtom} from "./sessionsSource"

/** Epoch ms, or 0 when the stamp is missing or unparsable. */
const at = (value?: string | null): number => Date.parse(value ?? "") || 0

/** Newest activity per agent, from the fetched session rows plus this browser's local usage. */
export const agentLastUsed = (
    rows: readonly SessionStream[],
    local: Record<string, number> = {},
): Map<string, number> => {
    const lastUsed = new Map(Object.entries(local))
    for (const row of rows) {
        const agentId = sessionAgentId(row)
        if (!agentId) continue
        const activity = at(row.updated_at ?? row.created_at)
        if (activity > (lastUsed.get(agentId) ?? 0)) lastUsed.set(agentId, activity)
    }
    return lastUsed
}

/** Last used, else the agent's own stamp — so an agent you just created still opens at the top. */
const rank = (workflow: Workflow, lastUsed: ReadonlyMap<string, number>): number =>
    lastUsed.get(workflow.id) ?? at(workflow.updated_at ?? workflow.created_at)

/** Newest first. Ranks are computed once per agent (not inside the comparator), and `Array#sort`
 * is stable, so agents with equal keys keep the source order. */
export const sortAgentsByLastUsed = (
    workflows: readonly Workflow[],
    lastUsed: ReadonlyMap<string, number>,
): Workflow[] =>
    workflows
        .map((workflow) => ({workflow, key: rank(workflow, lastUsed)}))
        .sort((a, b) => b.key - a.key)
        .map(({workflow}) => workflow)

const sortedSidebarAgentsAtom = atom((get) => {
    const {data} = get(agentWorkflowsListQueryStateAtom)
    const lastUsed = agentLastUsed(get(sidebarSessionRowsAtom), get(localAgentActivityAtom))
    return sortAgentsByLastUsed(data, lastUsed)
})

/**
 * Holds the sorted array reference steady while the order is unchanged. A settled chat turn
 * rewrites the activity map and re-runs the sort, but if the resulting order matches the last one
 * the previous array is returned — so the Agents group does not re-render on every turn.
 */
const stableSortedSidebarAgentsAtom = selectAtom(
    sortedSidebarAgentsAtom,
    (agents) => agents,
    (a, b) => a.length === b.length && a.every((workflow, index) => workflow === b[index]),
)

/** The agents list, most recently used first — sorted so the order lands before the group's
 * five-item cut in `resolveChildren`, with the full list left for the "Show all" count. */
export const sidebarAgentsListAtom = atom<ListQueryState<Workflow>>((get) => {
    const query = get(agentWorkflowsListQueryStateAtom)
    return {...query, data: get(stableSortedSidebarAgentsAtom)}
})
