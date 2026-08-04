import {useCallback, useMemo} from "react"

import {type SessionStream} from "@agenta/entities/session"
import {PushPinIcon} from "@phosphor-icons/react"
import {Dropdown, Skeleton, Tooltip} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import {AnimatePresence, MotionConfig, motion} from "motion/react"
import Link from "next/link"

import {ROW_VARIANTS, SESSION_SPRING} from "@/oss/components/AgentChatSlice/assets/sessionMotion"
import {sessionOpenTarget} from "@/oss/components/AgentChatSlice/assets/sessionOpenTarget"
import {useOpenAgentSession} from "@/oss/components/AgentChatSlice/hooks/useOpenAgentSession"
import {useSessionActions} from "@/oss/components/AgentChatSlice/hooks/useSessionActions"
import {timeAgo} from "@/oss/components/AgentChatSlice/state/sessions"
import useURL from "@/oss/hooks/useURL"
import {projectIdAtom} from "@/oss/state/project"

import {sessionRowStatus} from "../assets/sessionRowStatus"
import {pinnedSessionIdsAtom, toggleSessionPinAtom} from "../state/pins"
import {
    pendingCountBySession,
    rowsFromPages,
    useActionableInteractions,
    useSessionList,
} from "../state/useSessionList"

import SessionAgentLabel from "./SessionAgentLabel"

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
    /** Floor for the card in a column layout — one row (or none) must not collapse it to a
     * sliver next to a full-height neighbour. */
    minHeightClassName?: string
}

/**
 * A session list for Home — the same rows and the same right-click actions as the sessions page,
 * so the two surfaces stay one thing rather than two that look alike.
 */
const SessionListCard = ({
    title,
    agentId,
    origin,
    emptyText,
    limit = 7,
    withPinned = false,
    minHeightClassName,
}: Props) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const pinnedIds = useAtomValue(pinnedSessionIdsAtom)
    const togglePin = useSetAtom(toggleSessionPinAtom)
    const openSession = useOpenAgentSession()
    const actions = useSessionActions()
    const {projectURL} = useURL()

    const interactions = useActionableInteractions(projectId)
    const pendingBySession = useMemo(
        () => pendingCountBySession(interactions.data),
        [interactions.data],
    )

    const usePins = withPinned && pinnedIds.length > 0
    const pinnedQuery = useSessionList({agentId, origin, sessionIds: pinnedIds, enabled: usePins})
    const listQuery = useSessionList({
        agentId,
        origin,
        excludeSessionIds: withPinned ? pinnedIds : undefined,
        // Automations are their own list here, so they must not also appear in the recent one.
        showTriggered: Boolean(origin),
    })

    // Membership stays the server's, but which GROUP a loaded row renders in is decided here —
    // otherwise pinning waits for two queries to come back before anything moves. Rows are taken
    // from whichever query already has them, so the move costs no fetch.
    const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds])
    const listRows = rowsFromPages(listQuery.data?.pages)
    const knownById = useMemo(() => {
        const byId = new Map<string, SessionStream>()
        for (const row of [...(usePins ? rowsFromPages(pinnedQuery.data?.pages) : []), ...listRows])
            byId.set(row.session_id, row)
        return byId
    }, [pinnedQuery.data?.pages, listRows, usePins])

    // `limit` caps the CARD, not each group. Applying it per-group made every pin add a row at
    // the top without dropping one at the bottom, so the card grew by a row each time — which is
    // the height change you see mid-transition. Pinning a visible row is now a pure reorder.
    const allPinned = usePins
        ? pinnedIds.flatMap((id) => {
              const row = knownById.get(id)
              return row ? [row] : []
          })
        : []
    const pinnedRows = allPinned.slice(0, limit)
    const rows = listRows
        .filter((row) => !pinnedSet.has(row.session_id))
        .slice(0, Math.max(0, limit - pinnedRows.length))

    const handleOpen = useCallback(
        (row: SessionStream) => {
            const target = sessionOpenTarget(row)
            if (target) openSession(target)
        },
        [openSession],
    )

    const renderRow = (row: SessionStream, pinned: boolean) => {
        const status = sessionRowStatus(row, pendingBySession?.get(row.session_id))
        const target = sessionOpenTarget(row)
        const activity = row.updated_at ?? row.created_at
        const actionTarget = {
            sessionId: row.session_id,
            appId: target?.appId ?? null,
            name: row.name,
            archived: Boolean(row.archived_at),
        }

        return (
            <motion.div
                key={row.session_id}
                layout
                variants={ROW_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
                className="overflow-hidden"
            >
                <Dropdown
                    trigger={["contextMenu"]}
                    menu={{
                        items: actions.menuItems(actionTarget, {onOpen: () => handleOpen(row)}),
                        onClick: actions.onMenuClick(actionTarget, {onOpen: () => handleOpen(row)}),
                    }}
                >
                    <button
                        type="button"
                        onClick={() => handleOpen(row)}
                        className="group flex w-full cursor-pointer items-center gap-3 border-0 border-b border-solid border-colorBorderSecondary bg-transparent px-2 py-2 text-left hover:bg-colorFillQuaternary"
                    >
                        <Tooltip title={status.label}>
                            <span
                                className={`h-2 w-2 shrink-0 rounded-full ${status.dotClassName}`}
                            />
                        </Tooltip>
                        <span className="min-w-0 flex-1 truncate text-xs text-colorText">
                            {row.name?.trim() || "Untitled session"}
                        </span>
                        <span className="w-32 shrink-0 truncate text-right">
                            <SessionAgentLabel appId={target?.appId ?? null} />
                        </span>
                        <span className="w-16 shrink-0 text-right text-xs text-colorTextTertiary">
                            {activity ? timeAgo(Date.parse(activity)) : "—"}
                        </span>
                        <Tooltip title={pinned ? "Unpin" : "Pin"}>
                            <span
                                role="button"
                                tabIndex={-1}
                                aria-label={pinned ? "Unpin session" : "Pin session"}
                                onClick={(event) => {
                                    event.stopPropagation()
                                    togglePin(row.session_id)
                                }}
                                className={`shrink-0 text-colorTextTertiary ${
                                    pinned ? "" : "opacity-0 group-hover:opacity-100"
                                }`}
                            >
                                <PushPinIcon size={14} weight={pinned ? "fill" : "regular"} />
                            </span>
                        </Tooltip>
                    </button>
                </Dropdown>
            </motion.div>
        )
    }

    return (
        <section
            className={`flex flex-col rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer px-3 py-3 ${minHeightClassName ?? ""}`}
        >
            <div className="mb-1 flex items-baseline justify-between">
                <h3 className="m-0 text-xs font-medium text-colorText">{title}</h3>
                <Link href={`${projectURL}/sessions`} className="text-xs">
                    View all
                </Link>
            </div>

            {listQuery.isPending ? (
                <Skeleton active paragraph={{rows: 4}} title={false} />
            ) : (
                <MotionConfig transition={SESSION_SPRING} reducedMotion="user">
                    <AnimatePresence initial={false}>
                        {pinnedRows.length > 0 ? (
                            <motion.p
                                key="pinned-heading"
                                layout
                                variants={ROW_VARIANTS}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                                className="m-0 overflow-hidden px-2 pt-1 text-xs text-colorTextTertiary"
                            >
                                Pinned {pinnedRows.length}
                            </motion.p>
                        ) : null}
                        {pinnedRows.map((row) => renderRow(row, true))}
                        {rows.map((row) => renderRow(row, false))}
                    </AnimatePresence>

                    {rows.length === 0 && pinnedRows.length === 0 ? (
                        // Deliberately short: an empty card in the rail should take the space it
                        // needs for one sentence, not reserve a list's worth of height.
                        <p className="m-0 px-2 py-3 text-xs text-colorTextTertiary">{emptyText}</p>
                    ) : null}
                </MotionConfig>
            )}
        </section>
    )
}

export default SessionListCard
