import {memo, type ReactNode} from "react"

import {type SessionRowVm} from "@agenta/sessions/row"
import {timeAgo} from "@agenta/shared/utils"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {DotsThreeIcon} from "@phosphor-icons/react"
import clsx from "clsx"

import {isMenuDivider, type SessionMenuEntry} from "./menu"
import {SessionAgentName} from "./SessionAgentName"
import {SessionAutomationKind} from "./SessionAutomationKind"
import {SessionPinButton} from "./SessionPinButton"
import {SessionStatusIcon} from "./SessionStatusIcon"

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
    const openable = Boolean(row.agentId && onOpen)
    const handleOpen = () => {
        if (openable) onOpen?.()
    }

    return (
        // A plain container, not an ARIA button: descendants of a button role are
        // presentational, which would hide the pin, menu and agent slot from AT. The click
        // here is a pointer convenience; the TITLE button below is the semantic open action.
        <div
            onClick={handleOpen}
            className={clsx(
                "group flex items-start gap-3 px-2 py-3 border-solid border-0 border-b border-colorBorderSecondary",
                openable ? "cursor-pointer hover:bg-colorFillQuaternary" : "cursor-default",
            )}
        >
            <SessionStatusIcon status={row.status} automation={row.isAutomation} />

            <button
                type="button"
                disabled={!openable}
                onClick={(event) => {
                    event.stopPropagation()
                    handleOpen()
                }}
                className={clsx(
                    "flex-1 min-w-0 flex flex-col gap-1 border-0 bg-transparent p-0 text-left",
                    openable ? "cursor-pointer" : "cursor-default",
                )}
            >
                <span className="flex w-full min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-colorText">
                        {row.title}
                    </span>
                    {row.automation ? <SessionAutomationKind kind={row.automation.kind} /> : null}
                </span>
                {row.subtitle ? (
                    <span className="w-full truncate text-[13px] text-colorTextTertiary">
                        {row.subtitle}
                    </span>
                ) : null}
            </button>

            {/* h-5 = the title's line box, so the trailing controls centre on the TITLE rather
                than on a row whose height the subtitle decides. */}
            <div className="flex h-5 shrink-0 items-center gap-3">
                {row.status.chipLabel ? (
                    <span
                        className={clsx(
                            "shrink-0 rounded px-1.5 py-0.5 text-xs leading-none",
                            row.status.chipClassName,
                        )}
                    >
                        {row.status.chipLabel}
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
                    <SessionPinButton
                        pinned={row.isPinned}
                        onToggle={() => onTogglePin(row.id)}
                        revealOnHover={revealActionsOnHover}
                    />
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
                        <DropdownMenuContent
                            align="end"
                            onClick={(event) => event.stopPropagation()}
                        >
                            {menuItems.map((entry, index) =>
                                isMenuDivider(entry) ? (
                                    <DropdownMenuSeparator key={`divider-${index}`} />
                                ) : (
                                    <DropdownMenuItem
                                        key={entry.key}
                                        disabled={entry.disabled}
                                        variant={entry.danger ? "destructive" : "default"}
                                        onSelect={(event) => {
                                            event.stopPropagation()
                                            onMenuSelect?.(entry.key)
                                        }}
                                    >
                                        {entry.label}
                                    </DropdownMenuItem>
                                ),
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
            </div>
        </div>
    )
}

export const SessionRow = memo(SessionRowImpl)
