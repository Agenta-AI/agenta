import {useCallback, useMemo} from "react"

import type {SessionRowVm} from "@agenta/sessions/row"
import {applySessionScopeAtom, useSessionCardList} from "@agenta/sessions/state"
import {PANEL_ACTION_CLASS, PanelSection} from "@agenta/ui/components/presentational"
import {ArrowRightIcon} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"
import Link from "next/link"

import type {SessionMenuEntry} from "./menu"
import {SessionCardList} from "./SessionCardList"

export interface SessionListPanelProps {
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
    /** Where the header links go — the sessions list, scoped to what this card was showing. */
    viewAllHref: string
    /** Host verb: open a row. */
    onOpenRow: (vm: SessionRowVm) => void
    /** Host verb: the row context menu. Omit on touch surfaces that have no menu. */
    menuFor?: (vm: SessionRowVm) => SessionMenuEntry[]
    onMenuSelect?: (vm: SessionRowVm, key: string) => void
    /** Keep the pin affordance visible without hover — touch has none. */
    alwaysShowPin?: boolean
}

/**
 * A session list inside the panel chrome — the SAME card both apps render on Home: title, the
 * waiting badge, "View all", and the shared `SessionCardList` rows beneath it. The host injects
 * only what it alone owns: how a row opens and its context menu.
 */
export const SessionListPanel = ({
    title,
    agentId,
    origin,
    emptyText,
    limit = 7,
    withPinned = false,
    minHeightClassName,
    viewAllHref,
    onOpenRow,
    menuFor,
    onMenuSelect,
    alwaysShowPin,
}: SessionListPanelProps) => {
    // Only the header badge reads the list here; the shared card list runs the same hook (one
    // query — the args match, so the fetch is shared through the query cache).
    const list = useSessionCardList({
        agentId,
        policy: {
            origin: origin ? "trigger-only" : "exclude-trigger",
            expansions: origin ? ["trigger"] : [],
        },
        limit,
        withPinned,
    })
    const applyScope = useSetAtom(applySessionScopeAtom)

    // Every link out of this card lands on the set the card was showing, not on a default list.
    const linkScope = useMemo(() => ({agentId: agentId ?? null, origin}), [agentId, origin])
    const handleViewAll = useCallback(() => applyScope(linkScope), [applyScope, linkScope])
    const handleWaitingClick = useCallback(
        () => applyScope({...linkScope, status: "waiting"}),
        [applyScope, linkScope],
    )

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
                        href={viewAllHref}
                        onClick={handleWaitingClick}
                        className="shrink-0 rounded bg-colorWarningBg px-1.5 py-0.5 text-xs leading-none text-colorWarningText"
                    >
                        {list.waitingTotal} waiting
                    </Link>
                ) : null
            }
            extra={
                <Link href={viewAllHref} onClick={handleViewAll} className={PANEL_ACTION_CLASS}>
                    View all
                    <ArrowRightIcon size={12} />
                </Link>
            }
        >
            <SessionCardList
                agentId={agentId}
                policy={{
                    origin: origin ? "trigger-only" : "exclude-trigger",
                    expansions: origin ? ["trigger"] : [],
                }}
                limit={limit}
                withPinned={withPinned}
                emptyText={emptyText}
                onOpenRow={onOpenRow}
                menuFor={menuFor}
                onMenuSelect={onMenuSelect}
                alwaysShowPin={alwaysShowPin}
            />
        </PanelSection>
    )
}
