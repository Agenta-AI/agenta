import {useCallback, useMemo} from "react"

import {type SessionStream} from "@agenta/entities/session"
import {PushPinIcon} from "@phosphor-icons/react"
import {Button, Skeleton, Tooltip} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import Link from "next/link"

import {sessionOpenTarget} from "@/oss/components/AgentChatSlice/assets/sessionOpenTarget"
import {useOpenAgentSession} from "@/oss/components/AgentChatSlice/hooks/useOpenAgentSession"
import {timeAgo} from "@/oss/components/AgentChatSlice/state/sessions"
import {sessionRowStatus} from "@/oss/components/pages/sessions/assets/sessionRowStatus"
import {
    pinnedSessionIdsAtom,
    toggleSessionPinAtom,
} from "@/oss/components/pages/sessions/state/pins"
import {
    pendingCountBySession,
    rowsFromPages,
    useActionableInteractions,
    useSessionList,
} from "@/oss/components/pages/sessions/state/useSessionList"
import useURL from "@/oss/hooks/useURL"
import {projectIdAtom} from "@/oss/state/project"

const HomeSessionRow = ({
    row,
    pendingCount,
    pinned,
    onOpen,
    onTogglePin,
}: {
    row: SessionStream
    pendingCount: number | undefined
    pinned: boolean
    onOpen: (row: SessionStream) => void
    onTogglePin: (sessionId: string) => void
}) => {
    const status = sessionRowStatus(row, pendingCount)
    const activity = row.updated_at ?? row.created_at

    return (
        <button
            type="button"
            onClick={() => onOpen(row)}
            className="group flex w-full cursor-pointer items-center gap-3 border-0 border-b border-solid border-colorBorderSecondary bg-transparent px-2 py-2 text-left hover:bg-colorFillQuaternary"
        >
            <Tooltip title={status.label}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${status.dotClassName}`} />
            </Tooltip>
            <span className="min-w-0 flex-1 truncate text-xs text-colorText">
                {row.name?.trim() || "Untitled session"}
            </span>
            <span className="shrink-0 text-xs text-colorTextTertiary">
                {activity ? timeAgo(Date.parse(activity)) : "—"}
            </span>
            <Tooltip title={pinned ? "Unpin" : "Pin"}>
                <span
                    role="button"
                    tabIndex={-1}
                    aria-label={pinned ? "Unpin session" : "Pin session"}
                    onClick={(event) => {
                        event.stopPropagation()
                        onTogglePin(row.session_id)
                    }}
                    className={`shrink-0 text-colorTextTertiary ${
                        pinned ? "" : "opacity-0 group-hover:opacity-100"
                    }`}
                >
                    <PushPinIcon size={14} weight={pinned ? "fill" : "regular"} />
                </span>
            </Tooltip>
        </button>
    )
}

/**
 * Pinned and recent sessions on Home. Pinned comes first and is deliberately not capped by
 * recency — a pinned conversation is one you return to for days, which is exactly what a
 * recency-ordered list buries.
 */
const HomeSessionsSection = () => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const pinnedIds = useAtomValue(pinnedSessionIdsAtom)
    const togglePin = useSetAtom(toggleSessionPinAtom)
    const openSession = useOpenAgentSession()
    const {projectURL} = useURL()

    const interactions = useActionableInteractions(projectId)
    const pendingBySession = useMemo(
        () => pendingCountBySession(interactions.data),
        [interactions.data],
    )

    const pinnedQuery = useSessionList({sessionIds: pinnedIds, enabled: pinnedIds.length > 0})
    const recentQuery = useSessionList({excludeSessionIds: pinnedIds})

    const pinnedRows = rowsFromPages(pinnedQuery.data?.pages)
    const recentRows = rowsFromPages(recentQuery.data?.pages).slice(0, 7)

    const handleOpen = useCallback(
        (row: SessionStream) => {
            const target = sessionOpenTarget(row)
            if (target) openSession(target)
        },
        [openSession],
    )

    const renderRow = (row: SessionStream, pinned: boolean) => (
        <HomeSessionRow
            key={row.session_id}
            row={row}
            pinned={pinned}
            pendingCount={pendingBySession?.get(row.session_id)}
            onOpen={handleOpen}
            onTogglePin={togglePin}
        />
    )

    return (
        <section>
            <div className="mb-2 flex items-baseline justify-between">
                <h3 className="m-0 text-xs font-medium text-colorText">Sessions</h3>
                <Link href={`${projectURL}/sessions`} className="text-xs">
                    View all
                </Link>
            </div>

            {recentQuery.isPending ? (
                <Skeleton active paragraph={{rows: 4}} title={false} />
            ) : (
                <>
                    {pinnedRows.length > 0 ? (
                        <>
                            <p className="m-0 px-2 py-1 text-xs text-colorTextTertiary">
                                Pinned {pinnedRows.length}
                            </p>
                            {pinnedRows.map((row) => renderRow(row, true))}
                        </>
                    ) : null}

                    {recentRows.map((row) => renderRow(row, false))}

                    {recentRows.length === 0 && pinnedRows.length === 0 ? (
                        <p className="m-0 px-2 py-6 text-center text-xs text-colorTextTertiary">
                            Your conversations will show up here.
                        </p>
                    ) : null}
                </>
            )}

            {recentQuery.isError ? (
                <div className="px-2 py-4 text-center">
                    <Button onClick={() => void recentQuery.refetch()}>Try again</Button>
                </div>
            ) : null}
        </section>
    )
}

export default HomeSessionsSection
