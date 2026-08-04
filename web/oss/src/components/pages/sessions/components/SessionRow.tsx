import {memo, useCallback, useMemo} from "react"

import {type SessionStream} from "@agenta/entities/session"
import {DotsThreeIcon, PushPinIcon, PushPinSlashIcon} from "@phosphor-icons/react"
import {Button, Dropdown, Tooltip} from "antd"
import clsx from "clsx"

import {sessionOpenTarget} from "@/oss/components/AgentChatSlice/assets/sessionOpenTarget"
import type {useSessionActions} from "@/oss/components/AgentChatSlice/hooks/useSessionActions"
import {timeAgo} from "@/oss/components/AgentChatSlice/state/sessions"

import {sessionRowStatus} from "../assets/sessionRowStatus"

import SessionAgentLabel from "./SessionAgentLabel"

export interface SessionRowActions {
    onOpen: (row: SessionStream) => void
    onTogglePin: (sessionId: string) => void
    onRename: (row: SessionStream) => void
    onArchive: (row: SessionStream) => void
    onDelete: (row: SessionStream) => void
}

interface Props extends SessionRowActions {
    /** Shared menu builder — see `useSessionActions`. */
    menuItems: ReturnType<typeof useSessionActions>["menuItems"]
    row: SessionStream
    pendingCount: number | undefined
    pinned: boolean
}

const SessionRow = ({
    row,
    menuItems,
    pendingCount,
    pinned,
    onOpen,
    onTogglePin,
    onRename,
    onArchive,
    onDelete,
}: Props) => {
    const status = sessionRowStatus(row, pendingCount)
    const target = useMemo(() => sessionOpenTarget(row), [row])
    const activity = row.updated_at ?? row.created_at
    const openable = Boolean(target)

    const handleOpen = useCallback(() => {
        if (target) onOpen(row)
    }, [onOpen, row, target])

    // Items come from the shared action set so this menu and the playground session bar's
    // context menu can't offer different verbs.
    const menu = useMemo(
        () => ({
            items: menuItems(
                {
                    sessionId: row.session_id,
                    appId: target?.appId ?? null,
                    name: row.name,
                    archived: Boolean(row.archived_at),
                },
                {onOpen: handleOpen},
            ),
            onClick: ({key, domEvent}: {key: string; domEvent: {stopPropagation: () => void}}) => {
                domEvent.stopPropagation()
                if (key === "open") handleOpen()
                if (key === "rename") onRename(row)
                if (key === "pin") onTogglePin(row.session_id)
                if (key === "archive") onArchive(row)
                if (key === "delete") onDelete(row)
            },
        }),
        [handleOpen, menuItems, onArchive, onDelete, onRename, onTogglePin, row, target],
    )

    return (
        <Dropdown menu={menu} trigger={["contextMenu"]}>
            <div
                role="button"
                tabIndex={openable ? 0 : -1}
                onClick={handleOpen}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") handleOpen()
                }}
                className={clsx(
                    "group flex items-center gap-3 px-3 py-2 border-solid border-0 border-b border-colorBorderSecondary",
                    openable ? "cursor-pointer hover:bg-colorFillQuaternary" : "cursor-default",
                )}
            >
                <Tooltip title={status.label}>
                    <span
                        aria-label={status.label}
                        className={clsx(
                            "shrink-0 w-2 h-2 rounded-full",
                            status.dotClassName,
                            status.pulse && "motion-safe:animate-pulse",
                        )}
                    />
                </Tooltip>

                <span className="flex-1 min-w-0 text-xs text-colorText truncate">
                    {row.name?.trim() || "Untitled session"}
                </span>

                {status.chipLabel ? (
                    <span
                        className={clsx(
                            "shrink-0 rounded px-1.5 py-0.5 text-[11px] leading-none",
                            status.chipClassName,
                        )}
                    >
                        {status.chipLabel}
                    </span>
                ) : null}

                <span className="w-40 shrink-0 truncate">
                    <SessionAgentLabel appId={target?.appId ?? null} />
                </span>

                <span className="w-24 shrink-0 text-xs text-colorTextTertiary text-right">
                    {activity ? timeAgo(Date.parse(activity)) : "—"}
                </span>

                <Tooltip title={pinned ? "Unpin" : "Pin"}>
                    <Button
                        type="text"
                        aria-label={pinned ? "Unpin session" : "Pin session"}
                        className={clsx(
                            "shrink-0",
                            !pinned && "opacity-0 group-hover:opacity-100 focus:opacity-100",
                        )}
                        icon={pinned ? <PushPinSlashIcon size={14} /> : <PushPinIcon size={14} />}
                        onClick={(event) => {
                            event.stopPropagation()
                            onTogglePin(row.session_id)
                        }}
                    />
                </Tooltip>

                <Dropdown menu={menu} trigger={["click"]}>
                    <Button
                        type="text"
                        aria-label="Session actions"
                        className="shrink-0"
                        icon={<DotsThreeIcon size={14} />}
                        onClick={(event) => event.stopPropagation()}
                    />
                </Dropdown>
            </div>
        </Dropdown>
    )
}

export default memo(SessionRow)
