/**
 * The agent picker's panel, bound to one skill: which agents already run it (ticked and inert)
 * and a tick that adds it to another. Connected on purpose, like the drawers: the usage query,
 * the add call and the invalidation live here once, so the detail drawer's flyout and a list
 * row's popover are the same control.
 */
import {useCallback, useMemo, useState} from "react"

import {AgentPickerPanel} from "@agenta/entity-ui/agent"
import {addSkillToAgents, buildSkillEmbedEntry, querySkillReferencedBy} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {message} from "@agenta/ui/app-message"
import {useQuery} from "@tanstack/react-query"

import type {SkillListItem} from "./types"

/** The usage query's key — the detail drawer reads the same one for its header count. */
export const skillUsageQueryKey = (projectId: string, workflowId: string) =>
    ["skills", "usage", projectId, workflowId] as const

export function SkillAgentPicker({
    projectId,
    skill,
}: {
    projectId: string
    skill: Pick<SkillListItem, "id" | "slug" | "name" | "description">
}) {
    const usageQuery = useQuery({
        queryKey: skillUsageQueryKey(projectId, skill.id),
        queryFn: () => querySkillReferencedBy({projectId, workflowId: skill.id}),
        enabled: Boolean(projectId && skill.id),
        staleTime: 15_000,
    })
    const usedByIds = useMemo(
        () =>
            (usageQuery.data?.referenced_by ?? []).map(
                (entry) => entry.agent_workflow_id ?? entry.agent_slug ?? "",
            ),
        [usageQuery.data],
    )

    // One agent at a time: the tick is the action, and the row's spinner is its progress.
    const [pendingId, setPendingId] = useState<string | null>(null)
    const add = useCallback(
        async (agentWorkflowId: string) => {
            setPendingId(agentWorkflowId)
            try {
                const entry = buildSkillEmbedEntry({
                    slug: skill.slug,
                    workflowId: skill.id,
                    name: skill.name,
                    description: skill.description,
                    mode: "latest",
                }) as unknown as Record<string, unknown>
                const outcome = await addSkillToAgents({
                    projectId,
                    agentWorkflowIds: [agentWorkflowId],
                    entry,
                    message: `Add skill ${skill.slug}`,
                })
                if (outcome.failed.length) {
                    message.error(`Couldn't add to that agent: ${outcome.failed[0].error}`)
                    return
                }
                await usageQuery.refetch()
                invalidateSkillsListCache()
            } catch (err) {
                message.error(
                    err instanceof Error && err.message
                        ? `Couldn't add to that agent: ${err.message}`
                        : "Couldn't add to that agent",
                )
            } finally {
                setPendingId(null)
            }
        },
        [projectId, skill, usageQuery],
    )

    return (
        <AgentPickerPanel
            selectedIds={usedByIds}
            selectedInert
            pendingId={pendingId}
            onSelect={(id) => void add(id)}
        />
    )
}
