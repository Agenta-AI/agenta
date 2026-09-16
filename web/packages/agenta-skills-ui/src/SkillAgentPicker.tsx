/**
 * The agent picker's panel, bound to one skill: the agents that run it are ticked, a tick adds
 * it to another, and un-ticking takes it back off. Connected on purpose, like the drawers: the
 * usage query, the two commits and the invalidation live here once, so the detail drawer's
 * flyout and a list row's popover are the same control.
 */
import {useCallback, useMemo, useState} from "react"

import {AgentPickerPanel} from "@agenta/entity-ui/agent"
import {
    addSkillToAgents,
    buildSkillEmbedEntry,
    querySkillReferencedBy,
    removeSkillFromAgents,
} from "@agenta/skills"
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
    // Each is one commit on the agent, so un-ticking is a real undo, not a hidden edit.
    const [pendingId, setPendingId] = useState<string | null>(null)
    const toggle = useCallback(
        async (agentWorkflowId: string) => {
            // One commit at a time: a second tick mid-flight would race the first's base.
            if (pendingId) return
            const remove = usedByIds.includes(agentWorkflowId)
            setPendingId(agentWorkflowId)
            try {
                const outcome = remove
                    ? await removeSkillFromAgents({
                          projectId,
                          agentWorkflowIds: [agentWorkflowId],
                          slug: skill.slug,
                          message: `Remove skill ${skill.slug}`,
                      })
                    : await addSkillToAgents({
                          projectId,
                          agentWorkflowIds: [agentWorkflowId],
                          entry: buildSkillEmbedEntry({
                              slug: skill.slug,
                              workflowId: skill.id,
                              name: skill.name,
                              description: skill.description,
                              mode: "latest",
                          }) as unknown as Record<string, unknown>,
                          message: `Add skill ${skill.slug}`,
                      })
                if (outcome.failed.length) throw new Error(outcome.failed[0].error)
                await usageQuery.refetch()
                invalidateSkillsListCache()
            } catch (err) {
                const verb = remove ? "remove from" : "add to"
                message.error(
                    err instanceof Error && err.message
                        ? `Couldn't ${verb} that agent: ${err.message}`
                        : `Couldn't ${verb} that agent`,
                )
            } finally {
                setPendingId(null)
            }
        },
        [pendingId, projectId, skill, usageQuery, usedByIds],
    )

    return (
        <AgentPickerPanel
            selectedIds={usedByIds}
            pendingId={pendingId}
            onSelect={(id) => void toggle(id)}
        />
    )
}
