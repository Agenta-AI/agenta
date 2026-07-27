import type {SessionStream} from "@agenta/entities/session"
import Link from "next/link"

import type {SessionLivenessBadge} from "./useLivenessPoll"

/** Raw relative time ("3h ago") — enough for the LITE phase, no dayjs. */
const timeAgo = (iso: string | null | undefined): string | null => {
    if (!iso) return null
    const then = Date.parse(iso)
    if (Number.isNaN(then)) return null
    const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
    if (seconds < 60) return "just now"
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
}

export const SessionRow = ({
    session,
    href,
    liveness,
    pendingApprovals = 0,
}: {
    session: SessionStream
    href: string
    /** Fresh badge from the shared liveness poll; `undefined` = poll unresolved (fall back to
     * the list row's own flags), `null` = poll resolved and this session is idle. */
    liveness?: SessionLivenessBadge | null
    /** Pending HITL approvals for this session (project-wide interactions poll). */
    pendingApprovals?: number
}) => {
    const agentLabel = session.references?.[0]?.slug ?? session.references?.[0]?.id ?? "—"
    const activity = timeAgo(session.updated_at ?? session.created_at)
    const badge =
        liveness === undefined ? (session.flags?.is_alive ? "alive" : null) : (liveness ?? null)
    return (
        <Link href={href} className="border-border flex flex-col gap-0.5 border-b px-4 py-3">
            <span className="text-xs font-medium">
                {session.name ?? "Untitled session"}
                {badge === "running" ? (
                    <span className="text-primary ml-2 font-normal">running</span>
                ) : badge === "alive" ? (
                    <span className="text-muted-foreground ml-2 font-normal">live</span>
                ) : null}
                {pendingApprovals > 0 ? (
                    <span className="text-primary ml-2 font-normal">needs approval</span>
                ) : null}
                {session.deleted_at ? (
                    <span className="text-muted-foreground ml-2 font-normal">ended</span>
                ) : null}
            </span>
            <span className="text-muted-foreground text-xs">
                {agentLabel}
                {activity ? ` · ${activity}` : ""}
            </span>
        </Link>
    )
}
