import {SAVE_AS_TEMPLATE_MESSAGE} from "@agenta/entities/workflow"
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

import {useProjectPermission} from "../context/useProjectPermission"
import {pendingTasksAtom, stashPendingTaskAtom} from "../home/pendingTask"

/** The agent menu of the session header: History, Rename, Export agent, Archive agent. */
export const AgentMenu = ({
    agentId,
    name,
    sessionId,
    canSend,
    projectId,
}: {
    agentId: string
    name: string
    sessionId: string
    canSend: boolean
    projectId: string
}) => {
    const t = useT(agentLayoutHeaderCatalog)
    const canEdit = useProjectPermission(projectId, "edit_workflows")
    const actions = useAgentActions()
    const openHistory = useSetAtom(openAgentVersionHistoryAtom)
    const store = useStore()
    const pending = useAtomValue(pendingTasksAtom)[sessionId] !== undefined
    const target = {id: agentId, name}
    return (
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
                    <DropdownMenuItem onSelect={() => actions.remove(target)}>
                        {t("agentLayout.header.archiveAgent")}
                    </DropdownMenuItem>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
