import {useCallback, useMemo, useRef} from "react"

import {useRestoreWorkflow, type AgentActionsMenuProps} from "@agenta/entity-ui/agent"
import {message} from "@agenta/ui/app-message"

import {startBlankSession} from "../chat/useStartBlankSession"
import {useProjectPermission} from "../context/useProjectPermission"

import type {AgentListRow} from "./agentListView"

export interface AgentRowActions {
    /** Whether the reader may archive and restore. False until the server confirms. */
    canEdit: boolean
    openPlayground: (row: AgentListRow) => void
    restore: (row: AgentListRow) => Promise<void>
}

/** What the roster's menu does beyond what the shared menu does itself. Called once per page. */
export const useAgentRowActions = (base: string, projectId: string): AgentRowActions => {
    const canEdit = useProjectPermission(projectId, "edit_workflows")
    const restoreAgent = useRestoreWorkflow()
    const restoring = useRef(new Set<string>())

    const openPlayground = useCallback(
        (row: AgentListRow) => {
            startBlankSession(base, row.id)
        },
        [base],
    )

    const restore = useCallback(
        async (row: AgentListRow) => {
            // A second press while the first is in flight is the same intent.
            if (restoring.current.has(row.id)) return
            restoring.current.add(row.id)
            try {
                if (await restoreAgent(row.id)) message.success("Agent restored")
                else message.error("Couldn't restore this agent")
            } finally {
                restoring.current.delete(row.id)
            }
        },
        [restoreAgent],
    )

    return useMemo(() => ({canEdit, openPlayground, restore}), [canEdit, openPlayground, restore])
}

/**
 * The menu props one row gets. An archived agent can only be restored; an active one can open a
 * chat, and is archived only by a reader who may.
 */
export const agentMenuProps = (
    row: AgentListRow,
    actions: AgentRowActions,
): Pick<AgentActionsMenuProps, "archived" | "onOpenPlayground" | "onRestore" | "canArchive"> =>
    row.archived
        ? {archived: true, onRestore: actions.canEdit ? () => void actions.restore(row) : undefined}
        : {onOpenPlayground: () => actions.openPlayground(row), canArchive: actions.canEdit}
