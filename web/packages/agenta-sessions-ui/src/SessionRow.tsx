import {memo, type ReactNode} from "react"

import {pendingGateLabel, type SessionRowVm} from "@agenta/sessions/row"
import {timeAgo} from "@agenta/shared/utils"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {DotsThreeIcon, PushPinIcon, PushPinSlashIcon} from "@phosphor-icons/react"
import clsx from "clsx"

import {Tip} from "./assets/Tip"
import {isMenuDivider, type SessionMenuEntry} from "./menu"
import {SessionAgentName} from "./SessionAgentName"

export interface SessionRowProps {
    row: SessionRowVm
    /** Off on an agent-scoped list, where every row names the same agent. */
    showAgent?: boolean
    /**
     * Web reveals the pin on hover; touch has no hover, so a touch surface turns this off and
     * the actions stay visible. Baked-in hover styling would hand mobile a dead control.
     */
    revealActionsOnHover?: boolean
    /** Replaces the built-in agent name — e.g. a surface that links the agent. */
    renderAgent?: (agentId: string | null) => ReactNode
    /** The app's verbs for this row, in the neutral shape. No items → no kebab. */
    menuItems?: SessionMenuEntry[]
    onMenuSelect?: (key: string) => void
    onOpen?: () => void
    onTogglePin?: (sessionId: string) => void
}

const SessionRowImpl = ({
    row,
    showAgent = true,
    revealActionsOnHover = true,
    renderAgent,
    menuItems,
    onMenuSelect,
    onOpen,
    onTogglePin,
}: SessionRowProps) => {
    const openable = Boolean(row.agentId)
    const handleOpen = () => {
        if (openable) onOpen?.()
    }

    return (
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
            <Tip title={row.status.label}>
                <span
                    aria-label={row.status.label}
                    className={clsx(
                        "shrink-0 w-2 h-2 rounded-full",
                        row.status.dotClassName,
                        row.status.pulse && "motion-safe:animate-pulse",
                    )}
                />
            </Tip>

            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="text-xs text-colorText truncate">{row.title}</span>
                {row.subtitle ? (
                    <span className="truncate text-[11px] text-colorTextTertiary">
                        {row.subtitle}
                    </span>
                ) : null}
            </span>

            {row.status.chipLabel ? (
                <span
                    className={clsx(
                        "shrink-0 rounded px-1.5 py-0.5 text-[11px] leading-none",
                        row.status.chipClassName,
                    )}
                >
                    {pendingGateLabel(row.pending?.kinds)}
                </span>
            ) : null}

            {showAgent ? (
                <span className="w-40 shrink-0 truncate">
                    {renderAgent ? (
                        renderAgent(row.agentId)
                    ) : (
                        <SessionAgentName agentId={row.agentId} />
                    )}
                </span>
            ) : null}

            <span className="w-24 shrink-0 text-xs text-colorTextTertiary text-right">
                {row.activityAt ? timeAgo(Date.parse(row.activityAt)) : "—"}
            </span>

            {onTogglePin ? (
                <Tip title={row.isPinned ? "Unpin" : "Pin"}>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={row.isPinned ? "Unpin session" : "Pin session"}
                        className={clsx(
                            "shrink-0",
                            !row.isPinned &&
                                revealActionsOnHover &&
                                "opacity-0 group-hover:opacity-100 focus:opacity-100",
                        )}
                        onClick={(event) => {
                            event.stopPropagation()
                            onTogglePin(row.id)
                        }}
                    >
                        {row.isPinned ? <PushPinSlashIcon size={14} /> : <PushPinIcon size={14} />}
                    </Button>
                </Tip>
            ) : null}

            {menuItems?.length ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Session actions"
                            className="shrink-0"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <DotsThreeIcon size={14} />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                        {menuItems.map((entry, index) =>
                            isMenuDivider(entry) ? (
                                <DropdownMenuSeparator key={`divider-${index}`} />
                            ) : (
                                <DropdownMenuItem
                                    key={entry.key}
                                    disabled={entry.disabled}
                                    variant={entry.danger ? "destructive" : "default"}
                                    onSelect={() => onMenuSelect?.(entry.key)}
                                >
                                    {entry.label}
                                </DropdownMenuItem>
                            ),
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
        </div>
    )
}

export const SessionRow = memo(SessionRowImpl)
