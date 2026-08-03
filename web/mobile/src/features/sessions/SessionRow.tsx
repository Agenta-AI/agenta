import type {SessionStream} from "@agenta/entities/session"
import Link from "next/link"

import {StatusTag} from "@/components/StatusTag"

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
    // Row flags are a lagging mirror of the Redis nest and go stale (rows sit at
    // is_running=true for days after a crashed run) — only the live poll may badge.
    const badge = liveness ?? null
    return (
        <Link href={href} className="border-border flex flex-col gap-1 border-b px-4 py-3">
            <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-xs font-medium">
                    {session.name ?? "Untitled session"}
                </span>
                {badge === "running" ? (
                    <StatusTag tone="running" dot>
                        running
                    </StatusTag>
                ) : badge === "alive" ? (
                    <StatusTag tone="live" dot>
                        live
                    </StatusTag>
                ) : null}
                {pendingApprovals > 0 ? (
                    <StatusTag tone="attention">
                        {pendingApprovals > 1 ? `${pendingApprovals} approvals` : "approval"}
                    </StatusTag>
                ) : null}
                {session.deleted_at ? <StatusTag tone="muted">ended</StatusTag> : null}
            </span>
            <span className="text-muted-foreground text-xs">
                {agentLabel}
                {activity ? ` · ${activity}` : ""}
            </span>
        </Link>
    )
}
