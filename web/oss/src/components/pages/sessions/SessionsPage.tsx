import {useCallback, useMemo} from "react"

import {type SessionRowVm} from "@agenta/sessions/row"
import {useSessionPins, useSessionsList} from "@agenta/sessions/state"
import {SessionFiltersPanel, SessionsListView} from "@agenta/sessions-ui"
import {PageLayout} from "@agenta/ui"
import {useAtomValue} from "jotai"

import {useOpenAgentSession} from "@/oss/components/AgentChatSlice/hooks/useOpenAgentSession"
import {
    useSessionActions,
    type SessionActionTarget,
} from "@/oss/components/AgentChatSlice/hooks/useSessionActions"

import {agentsWorkflowsAtom} from "../agents/store"

import {toSessionMenuEntries} from "./assets/menuEntries"

interface Props {
    /** Route-supplied agent scope (`/apps/[app_id]/sessions`). Omit for the project-wide list. */
    scopedAgentId?: string
    title?: string
}

const targetFor = (vm: SessionRowVm): SessionActionTarget => ({
    sessionId: vm.id,
    appId: vm.agentId,
    name: vm.stream.name,
    archived: Boolean(vm.stream.archived_at),
})

/**
 * The session list — the SHARED page body and filters panel (`@agenta/sessions-ui`, the same
 * ones mobile renders), inside the desktop shell. This file owns only the app-side verbs:
 * open on a playground, and the sessions context menu.
 */
const SessionsPage = ({scopedAgentId, title = "Sessions"}: Props) => {
    // Only the rail badge reads the list here; the shared view runs the same hook (same args →
    // one query through the cache).
    const list = useSessionsList({agentId: scopedAgentId})
    const {toggle: togglePin} = useSessionPins()
    const openSession = useOpenAgentSession()
    const sessionActions = useSessionActions()
    const agents = useAtomValue(agentsWorkflowsAtom)
    const agentOptions = useMemo(
        () => agents.map((agent) => ({id: agent.workflowId, name: agent.name})),
        [agents],
    )

    const handleOpen = useCallback(
        (vm: SessionRowVm) => {
            if (vm.agentId)
                openSession({
                    appId: vm.agentId,
                    sessionId: vm.id,
                    title: vm.stream.name?.trim() || undefined,
                })
        },
        [openSession],
    )
    const menuFor = useCallback(
        (vm: SessionRowVm) =>
            toSessionMenuEntries(
                sessionActions.menuItems(targetFor(vm), {onOpen: () => handleOpen(vm)}),
            ),
        [sessionActions, handleOpen],
    )
    const onMenuSelect = useCallback(
        (vm: SessionRowVm, key: string) => {
            const target = targetFor(vm)
            if (key === "open") handleOpen(vm)
            if (key === "rename") sessionActions.rename(target)
            if (key === "pin") togglePin(vm.id)
            if (key === "archive") void sessionActions.setArchived(target)
            if (key === "delete") sessionActions.remove(target)
        },
        [sessionActions, togglePin, handleOpen],
    )

    return (
        <PageLayout className="grow min-h-0 !p-0">
            <div className="flex min-h-0 w-full flex-1 flex-col lg:flex-row">
                <SessionFiltersPanel
                    title={title}
                    waitingCount={list.waitingCount}
                    agents={agentOptions}
                    hideAgentFilter={Boolean(scopedAgentId)}
                />
                <SessionsListView
                    scopedAgentId={scopedAgentId}
                    onOpenRow={handleOpen}
                    menuFor={menuFor}
                    onMenuSelect={onMenuSelect}
                    className="min-h-0 flex-1 overflow-y-auto px-6 pb-4"
                />
            </div>
        </PageLayout>
    )
}

export default SessionsPage
