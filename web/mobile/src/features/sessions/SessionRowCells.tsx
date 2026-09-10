import {useCallback, useMemo, type MouseEvent as ReactMouseEvent} from "react"
import type {ReactNode} from "react"

import {AgentChip} from "@agenta/entity-ui/agent"
import type {SessionRowStatusMeta, SessionRowVm} from "@agenta/sessions/row"
import {
    InlineRenameInput,
    SessionAgentName,
    useInlineRename,
    type SessionMenuEntry,
} from "@agenta/sessions-ui"
import {timeAgo} from "@agenta/shared/utils"
import {PencilSimple, PushPin} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

import {SessionRowMenu} from "./SessionRowMenu"

/** Archived is a state the reader chose. The kebab keeps full weight; unarchiving lives there. */
const FADED = "opacity-60"

/** A row's inline verb. Local rather than `SessionPinButton`, which carries a tooltip. */
const RowActionButton = ({
    label,
    onClick,
    children,
}: {
    label: string
    onClick: () => void
    children: ReactNode
}) => (
    <button
        type="button"
        aria-label={label}
        onClick={onClick}
        // The transparent ::after is the hit extender: 20px is under the touch guideline, and
        // growing the box itself would grow the row.
        className="relative flex size-5 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-colorTextTertiary transition-colors after:absolute after:inset-[-10px] after:content-[''] hover:bg-colorFillSecondary hover:text-colorText [@media(hover:hover)]:after:inset-[-4px]"
    >
        {children}
    </button>
)

/** Filled while something is happening, a hollow ring when not. The word is in the tooltip. */
const StatusDot = ({status}: {status: SessionRowStatusMeta}) => {
    const live = status.status === "waiting" || status.status === "running"
    return (
        <span
            role="img"
            aria-label={status.label}
            title={status.label}
            className={cn(
                "box-border size-[7px] shrink-0 rounded-full border-[1.5px] border-solid",
                live ? `${status.dotClassName} border-transparent` : "border-colorBorder",
            )}
        />
    )
}

/**
 * One session row's cells, in column order. A component, not a render function, because the row
 * owns the inline rename that both the pencil and the kebab drive; the boundary adds no DOM, so
 * the cells stay direct children of the table's grid.
 */
export const SessionRowCells = ({
    vm,
    narrow,
    entries,
    onMenuSelect,
    onRenameRow,
    onTogglePin,
}: {
    vm: SessionRowVm
    /** Below `sm` the table drops the Status and Agent columns — see `SessionListTable`. */
    narrow: boolean
    /** The shared verbs for this row, from `useSessionRowMenu`. */
    entries: SessionMenuEntry[]
    onMenuSelect: (vm: SessionRowVm, key: string) => void
    onRenameRow: (vm: SessionRowVm, name: string) => Promise<boolean>
    onTogglePin: (sessionId: string) => void
}) => {
    const onCommit = useCallback((name: string) => onRenameRow(vm, name), [onRenameRow, vm])
    const rename = useInlineRename({current: vm.title, onCommit})

    const onSelect = useCallback(
        (key: string) => {
            // Deferred, not run here: the editor must not mount inside the menu's focus trap.
            if (key === "rename") return () => rename.start()
            onMenuSelect(vm, key)
        },
        [onMenuSelect, rename, vm],
    )

    // The row opens the session; every control on it has to say so itself.
    const swallow = useCallback((event: ReactMouseEvent) => event.stopPropagation(), [])

    // `useSessionActions` drops rename and pin for an archived row; the inline pair follows it.
    const archived = Boolean(vm.stream.archived_at)
    const updated = useMemo(
        () => (vm.activityAt ? timeAgo(Date.parse(vm.activityAt)) : "—"),
        [vm.activityAt],
    )

    return (
        <>
            <span className={cn("flex min-w-0 items-center gap-2", archived && FADED)}>
                {/* Only where there is no Status column to carry it. */}
                {narrow ? <StatusDot status={vm.status} /> : null}
                {rename.renaming ? (
                    <span className="min-w-0 flex-1" onClick={swallow}>
                        {/* Preflight is off, so the border and font are stated. `focus`, not
                            `focus-visible`: the editor is focused the moment it mounts. */}
                        <InlineRenameInput
                            rename={rename}
                            className="h-7 w-full min-w-0 rounded-md border border-solid border-input bg-background px-2 text-[14px] leading-none text-foreground shadow-xs outline-none transition-[color,box-shadow] [font-family:inherit] selection:bg-primary selection:text-primary-foreground focus:border-ring focus:ring-[3px] focus:ring-ring/50 dark:bg-input/30"
                        />
                    </span>
                ) : (
                    <>
                        <span
                            className="min-w-0 truncate text-[14px] text-foreground"
                            title={vm.title}
                        >
                            {vm.title}
                        </span>
                        {archived ? null : (
                            <span
                                // Revealed on the ROW's hover, and gone below `sm` where the pair
                                // would cost the title 60px it cannot spare. The kebab has both.
                                className="hidden shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100 sm:flex"
                                onClick={swallow}
                                onKeyDown={(event) => event.stopPropagation()}
                            >
                                {/* The reveal is the wrapper's, not each button's. */}
                                <RowActionButton
                                    label={vm.isPinned ? "Unpin session" : "Pin session"}
                                    onClick={() => onTogglePin(vm.id)}
                                >
                                    {/* One control: a pinned row keeps the same pin, filled. */}
                                    <PushPin size={14} weight={vm.isPinned ? "fill" : "regular"} />
                                </RowActionButton>
                                <RowActionButton label="Rename session" onClick={rename.start}>
                                    <PencilSimple size={14} />
                                </RowActionButton>
                            </span>
                        )}
                    </>
                )}
            </span>

            {narrow ? null : (
                // A dot and a coloured word, never a pill: the column is read down, and a stack
                // of pills reads as a stack of buttons. Same shape the automations table uses.
                <span className={cn("flex min-w-0 items-center gap-[7px]", archived && FADED)}>
                    <StatusDot status={vm.status} />
                    <span className={cn("truncate text-[13px]", vm.status.textClassName)}>
                        {vm.status.label}
                    </span>
                </span>
            )}

            {narrow ? null : vm.agentId ? (
                <span className={cn("flex min-w-0 items-center gap-1.5", archived && FADED)}>
                    {/* The agent's own mark, not a generic robot — the same tile the automations
                        table and the agent picker draw. */}
                    <AgentChip workflowId={vm.agentId} box="size-5" glyph={13} />
                    <SessionAgentName agentId={vm.agentId} />
                </span>
            ) : (
                <SessionAgentName agentId={null} />
            )}

            <span
                className={cn(
                    "truncate text-right text-[13px] text-muted-foreground",
                    archived && FADED,
                )}
            >
                {updated}
            </span>

            <span className="flex justify-end" onClick={swallow}>
                <SessionRowMenu
                    entries={entries}
                    onSelect={onSelect}
                    label={vm.title || "Untitled session"}
                />
            </span>
        </>
    )
}
