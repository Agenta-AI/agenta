import {useEffect, useState} from "react"

import {agentWorkflowsListQueryStateAtom, SAVE_AS_TEMPLATE_MESSAGE} from "@agenta/entities/workflow"
import {useAgentActions} from "@agenta/entity-ui/agent"
import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import {openAgentVersionHistoryAtom} from "@agenta/playground-ui/agent-version-history"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {CaretDown} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom, useStore} from "jotai"
import {useRouter} from "next/router"

import {useProjectPermission} from "../context/useProjectPermission"
import {pendingTasksAtom, stashPendingTaskAtom} from "../home/pendingTask"

/** The agent menu of the session header: History, Rename, Export agent, Archive agent. */
export const AgentMenu = ({
    agentId,
    name,
    sessionId,
    canSend,
    projectId,
    base,
}: {
    agentId: string
    name: string
    sessionId: string
    canSend: boolean
    projectId: string
    /** The project URL: an archived agent leaves for its Agents list. */
    base: string
}) => {
    const t = useT(agentLayoutHeaderCatalog)
    const canEdit = useProjectPermission(projectId, "edit_workflows")
    const actions = useAgentActions()
    const openHistory = useSetAtom(openAgentVersionHistoryAtom)
    const store = useStore()
    const pending = useAtomValue(pendingTasksAtom)[sessionId] !== undefined
    const target = {id: agentId, name}
    // Set when the person picks Archive. The confirmation and the request belong to the shared
    // agent actions, so the menu learns the result from the agent list.
    const [archiveAsked, setArchiveAsked] = useState(false)
    return (
        <>
            {archiveAsked ? <LeaveWhenArchived agentId={agentId} base={base} /> : null}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={name} className="shrink-0">
                        <CaretDown size={12} />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                    <DropdownMenuItem onSelect={() => openHistory(agentId)}>
                        {t("agentLayout.header.history")}
                    </DropdownMenuItem>
                    {canEdit ? (
                        <DropdownMenuItem onSelect={() => actions.rename(target)}>
                            {t("agentLayout.header.rename")}
                        </DropdownMenuItem>
                    ) : null}
                    {canSend ? (
                        <DropdownMenuItem
                            disabled={pending}
                            onSelect={() => {
                                // Production "Save as template": the agent builds the download.
                                if (store.get(pendingTasksAtom)[sessionId]) return
                                store.set(stashPendingTaskAtom, {
                                    sessionId,
                                    task: {agentId, text: SAVE_AS_TEMPLATE_MESSAGE},
                                })
                            }}
                        >
                            {t("agentLayout.header.exportAgent")}
                        </DropdownMenuItem>
                    ) : null}
                    {canEdit ? (
                        <DropdownMenuItem
                            onSelect={() => {
                                setArchiveAsked(true)
                                actions.remove(target)
                            }}
                        >
                            {t("agentLayout.header.archiveAgent")}
                        </DropdownMenuItem>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    )
}

/**
 * Moves the screen to the Agents list once the agent is gone from the agent list, which is what
 * a confirmed archive does. Mounted only after Archive is picked, so the session screen does not
 * load the agent list for it. The route change also shows the main sidebar.
 */
export const LeaveWhenArchived = ({agentId, base}: {agentId: string; base: string}) => {
    const router = useRouter()
    const agents = useAtomValue(agentWorkflowsListQueryStateAtom)
    const listed = (agents.data ?? []).some((agent) => agent.id === agentId)
    // Only an agent this list has shown can leave it: an agent it never lists (a list still
    // loading, or one it does not cover) must not move the screen before the archive.
    const [seen, setSeen] = useState(false)
    useEffect(() => {
        if (listed) setSeen(true)
    }, [listed])
    const gone = seen && !listed && !agents.isPending && !agents.isError
    useEffect(() => {
        if (gone) void router.push(`${base}/agents`)
    }, [gone, base, router])
    return null
}
