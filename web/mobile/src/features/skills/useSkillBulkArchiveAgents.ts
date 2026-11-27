import {useMemo} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {querySkillReferencedBy} from "@agenta/skills"
import {skillUsageQueryKey} from "@agenta/skills-ui"
import {useQueries} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import type {SkillListRow} from "./skillListView"

/** The agents that use the skills the bulk Archive confirm names. */
export const useSkillBulkArchiveAgents = (rows: SkillListRow[], open: boolean) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    // Only a skill some agent uses is asked who; the same query the Used by cell runs.
    const used = useMemo(() => rows.filter((row) => row.usedByCount > 0), [rows])
    const usages = useQueries({
        queries: used.map((row) => ({
            queryKey: skillUsageQueryKey(projectId, row.id),
            queryFn: () => querySkillReferencedBy({projectId, workflowId: row.id}),
            enabled: open && Boolean(projectId),
            staleTime: 15_000,
        })),
    })
    const loading = usages.some((usage) => usage.isPending)
    const agents = [
        ...new Map(
            usages
                .flatMap((usage) => usage.data?.referenced_by ?? [])
                .map((ref) => [
                    ref.agent_workflow_id ?? ref.agent_slug ?? "",
                    ref.agent_name ?? ref.agent_slug ?? "",
                ]),
        ).values(),
    ].filter(Boolean)
    return {usedCount: used.length, loading, agents}
}
