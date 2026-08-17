import {useCallback, useMemo} from "react"

import {type SessionRowVm} from "@agenta/sessions/row"
import {useSessionPins, useSessionsList} from "@agenta/sessions/state"
import {SessionFiltersBar, SessionFiltersPanel, SessionsListView} from "@agenta/sessions-ui"
import {PageLayout} from "@agenta/ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {FilterRailLayout} from "@agenta/ui/components/presentational"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {useOpenAgentSession} from "@/oss/components/AgentChatSlice/hooks/useOpenAgentSession"
import {
    useSessionActions,
    type SessionActionTarget,
} from "@/oss/components/AgentChatSlice/hooks/useSessionActions"
import {sessionListPolicies} from "@/oss/lib/sessionListPolicies"

import {BROWSE_RAIL_MODE} from "../agent-home/assets/constants"
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
 * The session list — the SHARED page body and filters shell (`@agenta/sessions-ui`, the same
 * ones mobile renders), inside the desktop shell. This file owns only the app-side verbs:
 * open on a playground, and the sessions context menu.
 *
 * Two shells over the same filter atoms, picked by `BROWSE_RAIL_MODE`: the default toolbar sits
 * above the results inside the page's own column (#5833), the opt-in rail puts them beside it.
 */
const SessionsPage = ({scopedAgentId, title = "Sessions"}: Props) => {
    // Only the toolbar/rail badge reads the list here; the shared view runs the same hook (same
    // args → one query through the cache).
    const list = useSessionsList({
        agentId: scopedAgentId,
        // Release contract: the human list hides automation runs; the "show triggered" toggle
        // swaps in the automation policy. See the QA note in the merge log.
        defaultPolicy: {origin: "exclude-trigger", expansions: []},
        automationPolicy: {origin: "trigger-only", expansions: ["trigger"]},
    })
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

    if (!BROWSE_RAIL_MODE)
        return (
            // The page's own title and gutters, so sessions shares one column width with the rest
            // of the app; the filters are a toolbar above the results.
            <PageLayout className={clsx(pageContentWidthClass, "grow min-h-0")} title={title}>
                <div className="flex min-h-0 flex-1 flex-col">
                    {/* No `title` here — `PageLayout` already carries it; the bar would repeat it.
                        `!px-0` drops the bar's own gutters: inside the page column they would
                        indent search 16px past the rows underneath it. */}
                    <SessionFiltersBar
                        className="!px-0"
                        waitingCount={list.waitingCount}
                        agents={agentOptions}
                        hideAgentFilter={Boolean(scopedAgentId)}
                    />

                    <SessionsListView
                        scopedAgentId={scopedAgentId}
                        onOpenRow={handleOpen}
                        menuFor={menuFor}
                        onMenuSelect={onMenuSelect}
                        className="min-h-0 flex-1 overflow-y-auto"
                    />
                </div>
            </PageLayout>
        )

    return (
        <PageLayout className="grow min-h-0 !p-0">
            {/* The shared browse frame: filters live in the rail, so search never scrolls away
                with the list. */}
            <FilterRailLayout
                rail={
                    <SessionFiltersPanel
                        title={title}
                        waitingCount={list.waitingCount}
                        agents={agentOptions}
                        hideAgentFilter={Boolean(scopedAgentId)}
                    />
                }
            >
                <SessionsListView
                    scopedAgentId={scopedAgentId}
                    onOpenRow={handleOpen}
                    menuFor={menuFor}
                    onMenuSelect={onMenuSelect}
                    className="min-h-0 flex-1 overflow-y-auto px-6 pb-4"
                />
            </FilterRailLayout>
        </PageLayout>
    )
}

export default SessionsPage
