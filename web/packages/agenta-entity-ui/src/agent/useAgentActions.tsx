import {useCallback} from "react"

import {archiveWorkflow, updateWorkflow} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {message, modal} from "@agenta/ui/app-message"
import {Input} from "@agenta/ui/ui"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

export interface AgentActionTarget {
    id: string
    name?: string | null
    slug?: string | null
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

    const revalidate = useCallback(() => {
        void queryClient.invalidateQueries({queryKey: ["workflows"]})
        void queryClient.invalidateQueries({queryKey: ["agent-workflows"]})
    }, [queryClient])

    const copy = useCallback(async (value: string, label: string) => {
        try {
            await navigator.clipboard.writeText(value)
            message.success(`${label} copied`)
        } catch {
            message.error(`Couldn't copy the ${label.toLowerCase()}`)
        }
    }, [])

    const rename = useCallback(
        (target: AgentActionTarget) => {
            let next = target.name ?? ""
            modal.confirm({
                title: "Rename agent",
                content: (
                    <Input
                        autoFocus
                        defaultValue={next}
                        aria-label="Agent name"
                        className="mt-2"
                        onChange={(event) => {
                            next = event.target.value
                        }}
                    />
                ),
                okText: "Rename",
                onOk: async () => {
                    const name = next.trim()
                    if (!name) return
                    try {
                        await updateWorkflow(projectId, {id: target.id, name})
                    } catch {
                        message.error("Couldn't rename this agent")
                        return
                    }
                    revalidate()
                },
            })
        },
        [projectId, revalidate],
    )

    const remove = useCallback(
        (target: AgentActionTarget) => {
            modal.confirm({
                title: "Delete agent",
                content: `"${target.name?.trim() || "This agent"}" will be archived along with its variants and revisions. Its past sessions stay readable.`,
                okText: "Delete",
                okButtonProps: {danger: true},
                onOk: async () => {
                    try {
                        await archiveWorkflow(projectId, target.id)
                    } catch {
                        message.error("Couldn't delete this agent")
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
