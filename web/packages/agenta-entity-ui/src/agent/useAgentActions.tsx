import {useCallback} from "react"

import {archiveWorkflow, unarchiveWorkflow, updateWorkflow} from "@agenta/entities/workflow"
import {createT} from "@agenta/i18n"
import agentActionsCatalog from "@agenta/i18n/catalogs/entityUi.agentActions"
import {projectIdAtom} from "@agenta/shared/state"
import {message, modal} from "@agenta/ui/app-message"
import {Input} from "@agenta/ui/ui"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

// Toasts and modals are opened from callbacks, so they translate at call time.
const tNow = createT(agentActionsCatalog)

export interface AgentActionTarget {
    id: string
    name?: string | null
    slug?: string | null
}

/** The rename write on its own, so an inline editor can commit without the confirm modal. */
export const useRenameAgent = () => {
    const queryClient = useQueryClient()
    const projectId = useAtomValue(projectIdAtom) ?? ""

    return useCallback(
        async (id: string, name: string): Promise<boolean> => {
            try {
                await updateWorkflow(projectId, {id, name})
            } catch {
                message.error(tNow("entityUi.agentActions.couldNotRename"))
                return false
            }
            void queryClient.invalidateQueries({queryKey: ["workflows"]})
            void queryClient.invalidateQueries({queryKey: ["agent-workflows"]})
            return true
        },
        [projectId, queryClient],
    )
}

/**
 * The restore write on its own: unarchive, then refresh the lists that show the agent. It reports
 * through its result and never toasts, because the host knows which noun and which surface.
 */
export const useRestoreWorkflow = () => {
    const queryClient = useQueryClient()
    const projectId = useAtomValue(projectIdAtom) ?? ""

    return useCallback(
        async (id: string): Promise<boolean> => {
            try {
                await unarchiveWorkflow(projectId, id)
            } catch (error) {
                console.error("Failed to restore the agent", error)
                return false
            }
            // Wait for the lists, so a caller guarding against a second press holds until the row
            // has left the archived list.
            await Promise.all([
                queryClient.invalidateQueries({queryKey: ["workflows"]}),
                queryClient.invalidateQueries({queryKey: ["agent-workflows"]}),
            ])
            return true
        },
        [projectId, queryClient],
    )
}

/** The description write on its own, for an inline editor. An empty string clears it. */
export const useUpdateAgentDescription = () => {
    const queryClient = useQueryClient()
    const projectId = useAtomValue(projectIdAtom) ?? ""

    return useCallback(
        async (id: string, description: string): Promise<boolean> => {
            try {
                await updateWorkflow(projectId, {id, description})
            } catch {
                message.error(tNow("entityUi.agentActions.couldNotUpdateDescription"))
                return false
            }
            void queryClient.invalidateQueries({queryKey: ["workflows"]})
            void queryClient.invalidateQueries({queryKey: ["agent-workflows"]})
            return true
        },
        [projectId, queryClient],
    )
}

/**
 * Everything you can do to an agent from its own surfaces, defined once — the same shape
 * [[useSessionActions]] gives sessions.
 *
 * A host with a richer flow of its own (the desktop's app-management modals, which also refresh
 * its apps cache) overrides `rename`/`remove` at the menu; a host without one gets these.
 */
export const useAgentActions = () => {
    const queryClient = useQueryClient()
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const renameAgent = useRenameAgent()

    const revalidate = useCallback(() => {
        void queryClient.invalidateQueries({queryKey: ["workflows"]})
        void queryClient.invalidateQueries({queryKey: ["agent-workflows"]})
    }, [queryClient])

    /** `messages` are the caller's own toasts, already translated. */
    const copy = useCallback(
        async (value: string, messages: {copied: string; failed: string}) => {
            try {
                await navigator.clipboard.writeText(value)
                message.success(messages.copied)
            } catch {
                message.error(messages.failed)
            }
        },
        [],
    )

    const rename = useCallback(
        (target: AgentActionTarget) => {
            let next = target.name ?? ""
            modal.confirm({
                title: tNow("entityUi.agentActions.renameAgent"),
                content: (
                    <Input
                        autoFocus
                        defaultValue={next}
                        aria-label={tNow("entityUi.agentActions.agentName")}
                        className="mt-2"
                        onChange={(event) => {
                            next = event.target.value
                        }}
                    />
                ),
                okText: tNow("entityUi.agentActions.rename"),
                onOk: async () => {
                    const name = next.trim()
                    if (name) await renameAgent(target.id, name)
                },
            })
        },
        [renameAgent],
    )

    const remove = useCallback(
        (target: AgentActionTarget) => {
            modal.confirm({
                title: tNow("entityUi.agentActions.archiveAgent"),
                content: tNow("entityUi.agentActions.archiveConfirm", {
                    name: target.name?.trim() || tNow("entityUi.agentActions.thisAgent"),
                }),
                okText: tNow("entityUi.agentActions.archive"),
                okButtonProps: {danger: true},
                onOk: async () => {
                    try {
                        await archiveWorkflow(projectId, target.id)
                    } catch {
                        message.error(tNow("entityUi.agentActions.couldNotArchive"))
                        return
                    }
                    revalidate()
                },
            })
        },
        [projectId, revalidate],
    )

    return {copy, rename, remove}
}
