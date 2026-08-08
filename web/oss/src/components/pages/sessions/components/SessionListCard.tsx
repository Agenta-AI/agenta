import {useCallback, useMemo} from "react"

import {type SessionRowVm} from "@agenta/sessions/row"
import {applySessionScopeAtom, useSessionCardList} from "@agenta/sessions/state"
import {SessionCardList} from "@agenta/sessions-ui"
import {PANEL_ACTION_CLASS, PanelSection} from "@agenta/ui/components/presentational"
import {ArrowRightIcon} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"
import Link from "next/link"

import {useOpenAgentSession} from "@/oss/components/AgentChatSlice/hooks/useOpenAgentSession"
import {useSessionActions} from "@/oss/components/AgentChatSlice/hooks/useSessionActions"
import useURL from "@/oss/hooks/useURL"

interface Props {
    title: string
    /** Scope to one agent's sessions — the app overview. Omit for the whole project. */
    agentId?: string
    /** Restrict to one origin (e.g. automation runs). Omit for everything but automations. */
    origin?: string
    emptyText: string
    limit?: number
    /** Pinned sessions lead the list, and are excluded from the recent rows below them. */
    withPinned?: boolean
    /** Floor for the card in a column layout — a short card should not collapse to a sliver. */
    minHeightClassName?: string
    /** Where the header links go. Defaults to the project sessions page, which needs the agent
     * handed over as a filter; an agent-scoped page carries that in its own route instead. */
    viewAllHref?: string
}

const actionTargetFor = (vm: SessionRowVm) => ({
    sessionId: vm.id,
    appId: vm.agentId,
    name: vm.stream.name,
    archived: Boolean(vm.stream.archived_at),
})

/**
 * A session list for Home — the shared `SessionCardList` (the SAME rows, pins and grouping
 * mobile renders) inside the desktop panel chrome, wired to the app's verbs: open in the
 * playground, and the sessions-page context menu.
 */
const SessionListCard = ({
    title,
    agentId,
    origin,
    emptyText,
    limit = 7,
    withPinned = false,
    minHeightClassName,
    viewAllHref,
}: Props) => {
    // Only the header badge reads the list here; the shared card list runs the same hook (one
    // query — the args match, so the fetch is shared through the query cache).
    const list = useSessionCardList({agentId, origin, limit, withPinned})
    const applyScope = useSetAtom(applySessionScopeAtom)
    const openSession = useOpenAgentSession()
    const actions = useSessionActions()
    const {projectURL} = useURL()

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
            actions.menuItems(actionTargetFor(vm), {onOpen: () => handleOpen(vm)}),
        [actions, handleOpen],
    )
    const onMenuSelect = useCallback(
        (vm: SessionRowVm, key: string) =>
            actions.onMenuClick(actionTargetFor(vm), {onOpen: () => handleOpen(vm)})({key}),
        [actions, handleOpen],
    )

    // Every link out of this card lands on the set the card was showing, not on a default list.
    const scopedHref = viewAllHref ?? `${projectURL}/sessions`
    const linkScope = useMemo(
        () => ({agentId: viewAllHref ? null : agentId, origin}),
        [agentId, origin, viewAllHref],
    )
    const handleViewAll = useCallback(() => {
        applyScope(linkScope)
    }, [applyScope, linkScope])
    const handleWaitingClick = useCallback(() => {
        applyScope({...linkScope, status: "waiting"})
    }, [applyScope, linkScope])

    return (
        <PanelSection
            sticky
            variant="page"
            title={title}
            minHeightClassName={minHeightClassName}
            bodyClassName="flex grow flex-col px-2 pb-2 pt-1"
            titleExtra={
                list.waitingTotal > 0 ? (
                    <Link
                        href={scopedHref}
                        onClick={handleWaitingClick}
                        className="shrink-0 rounded bg-colorWarningBg px-1.5 py-0.5 text-[11px] leading-none text-colorWarningText"
                    >
                        {list.waitingTotal} waiting
                    </Link>
                ) : null
            }
            extra={
                <Link href={scopedHref} onClick={handleViewAll} className={PANEL_ACTION_CLASS}>
                    View all
                    <ArrowRightIcon size={12} />
                </Link>
            }
        >
            <SessionCardList
                agentId={agentId}
                origin={origin}
                limit={limit}
                withPinned={withPinned}
                emptyText={emptyText}
                onOpenRow={handleOpen}
                menuFor={menuFor}
                onMenuSelect={onMenuSelect}
            />
        </PanelSection>
    )
}

export default SessionListCard
