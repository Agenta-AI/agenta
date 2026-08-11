import {useCallback, useMemo, type ReactNode} from "react"

import {applySessionScopeAtom, useSessionCardList} from "@agenta/sessions/state"
import {PANEL_ACTION_CLASS, PanelSection} from "@agenta/ui/components/presentational"
import {ArrowRightIcon} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"
import Link from "next/link"

import {SessionCardList, type SessionCardListProps} from "./SessionCardList"

export interface SessionListCardProps {
    title: string
    /** Scope to one agent's sessions — the app overview. Omit for the whole project. */
    agentId?: string
    /** Restrict to one origin (e.g. automation runs). Omit for everything but automations. */
    origin?: string
    emptyText: string
    limit?: number
    /** Pinned sessions lead the list, and are excluded from the recent rows below them. */
    withPinned?: boolean
    /** Keep the pin affordance visible instead of revealing it on hover (touch hosts). */
    alwaysShowPin?: boolean
    /** Floor for the card in a column layout — a short card should not collapse to a sliver. */
    minHeightClassName?: string
    /** Where the header links go — the host owns its routing. */
    viewAllHref: string
    /** The host's verbs, so one card serves a playground host and a mobile router alike. */
    onOpenRow: SessionCardListProps["onOpenRow"]
    menuFor?: SessionCardListProps["menuFor"]
    onMenuSelect?: SessionCardListProps["onMenuSelect"]
}

const WAITING_BADGE_CLASS =
    "shrink-0 rounded bg-colorWarningBg px-1.5 py-0.5 text-xs leading-none text-colorWarningText"

/** The waiting badge, as a link when the host knows where it goes and as plain text until then. */
const BadgeShell = ({
    href,
    onClick,
    children,
}: {
    href?: string
    onClick: () => void
    children: ReactNode
}) =>
    href ? (
        <Link href={href} onClick={onClick} className={WAITING_BADGE_CLASS}>
            {children}
        </Link>
    ) : (
        <span className={WAITING_BADGE_CLASS}>{children}</span>
    )

/**
 * THE session list card: the shared `SessionCardList` (same rows, pins and grouping) inside the
 * panel chrome, with the header's waiting badge and "View all" link. One definition for the
 * desktop overview and the mobile screen — opening a row and the row menu arrive as props,
 * because only those are genuinely the host's.
 */
export const SessionListCard = ({
    title,
    agentId,
    origin,
    emptyText,
    limit = 7,
    withPinned = false,
    alwaysShowPin,
    minHeightClassName,
    viewAllHref,
    onOpenRow,
    menuFor,
    onMenuSelect,
}: SessionListCardProps) => {
    // Only the header badge reads the list here; the shared card list runs the same hook (one
    // query — the args match, so the fetch is shared through the query cache).
    const list = useSessionCardList({agentId, origin, limit, withPinned})
    const applyScope = useSetAtom(applySessionScopeAtom)

    // Every link out of this card lands on the set the card was showing, not on a default list.
    const linkScope = useMemo(() => ({agentId: agentId ?? null, origin}), [agentId, origin])
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
                    <BadgeShell href={viewAllHref} onClick={handleWaitingClick}>
                        {list.waitingTotal} waiting
                    </BadgeShell>
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
                origin={origin}
                limit={limit}
                withPinned={withPinned}
                alwaysShowPin={alwaysShowPin}
                emptyText={emptyText}
                onOpenRow={onOpenRow}
                menuFor={menuFor}
                onMenuSelect={onMenuSelect}
            />
        </PanelSection>
    )
}
