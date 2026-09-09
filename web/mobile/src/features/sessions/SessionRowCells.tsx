import {useCallback, useMemo, type MouseEvent as ReactMouseEvent} from "react"

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
import type {ReactNode} from "react"

import {cn} from "@/lib/utils"

import {SessionRowMenu} from "./SessionRowMenu"

/**
 * An archived row is still readable, just not competing: archived is a state the reader chose to
 * put a session out of the way, and under the Archived filter a whole page at full strength reads
 * as the live list. The kebab keeps its own weight — unarchiving is the point of being here.
 */
const FADED = "opacity-60"

/**
 * A row's inline verb — a real button with a box and a hover fill, not a bare glyph, so it reads
 * as something to press.
 *
 * Local rather than `SessionPinButton`: that one carries a tooltip, and two tooltips firing off a
 * row you are only passing over is noise. The `aria-label` still names it.
 */
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

/**
 * The row's whole status, as one 7px mark.
 *
 * Filled while something is happening, a hollow ring when it is not — a list where every row
 * carries a solid dot has told the reader nothing. The word is in the tooltip and in the Status
 * grouping; on a line this narrow a chip would cost the title its width.
 */
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
 * One session row's cells, in column order.
 *
 * A component rather than a bare render function because a row owns state: the inline rename,
 * which both the pencil and the kebab's "Rename" drive. A component boundary adds no DOM, so the
 * four cells below stay direct children of the table's grid.
 *
 * Pin and rename sit beside the title rather than hiding until hover — this app is a touch
 * surface and there is no hover to reveal them with.
 */
export const SessionRowCells = ({
    vm,
    showAgent,
    entries,
    onMenuSelect,
    onRenameRow,
    onTogglePin,
}: {
    vm: SessionRowVm
    /** Off below `sm`, where the table drops the Agent column — see `SessionListTable`. */
    showAgent: boolean
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

    // An archived session is out of the way on purpose, and `useSessionActions` drops rename and
    // pin from its menu for that reason. The inline pair honours the same rule, or the row would
    // offer two verbs the shared model refuses.
    const archived = Boolean(vm.stream.archived_at)
    const updated = useMemo(
        () => (vm.activityAt ? timeAgo(Date.parse(vm.activityAt)) : "—"),
        [vm.activityAt],
    )

    return (
        <>
            <span className={cn("flex min-w-0 items-center gap-2", archived && FADED)}>
                <StatusDot status={vm.status} />
                {rename.renaming ? (
                    <span className="min-w-0 flex-1" onClick={swallow}>
                        {/* This app's own field, not the package default: preflight is off here,
                            so the border and the font have to be stated, and the ring is the one
                            every other input on this surface draws. `focus`, not `focus-visible`
                            — the editor is focused programmatically the moment it mounts. */}
                        <InlineRenameInput
                            rename={rename}
                            className="h-7 w-full min-w-0 rounded-md border border-solid border-input bg-background px-2 text-[14px] leading-none text-foreground shadow-xs outline-none transition-[color,box-shadow] [font-family:inherit] selection:bg-primary selection:text-primary-foreground focus:border-ring focus:ring-[3px] focus:ring-ring/50 dark:bg-input/30"
                        />
                    </span>
                ) : (
                    <>
                        <span className="min-w-0 truncate text-[14px] text-foreground" title={vm.title}>
                            {vm.title}
                        </span>
                        {archived ? null : (
                            <span
                                // Revealed on the ROW's hover, so a resting list is titles and
                                // nothing else; `focus-within` keeps them reachable by keyboard,
                                // and `pointer-coarse` keeps them out on a touch screen that has
                                // no hover to reveal them with.
                                //
                                // Gone below `sm`, where the title is already down to a dozen
                                // characters and the pair would cost it 60px more. The kebab
                                // carries both verbs, so nothing is unreachable there.
                                className={cn(
                                    "hidden shrink-0 items-center gap-1 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100 sm:flex",
                                    // A pinned row keeps its pin: the filled glyph IS how the row
                                    // says it is pinned, and hiding it leaves the fact to the
                                    // group heading alone.
                                    !vm.isPinned && "opacity-0",
                                )}
                                onClick={swallow}
                                onKeyDown={(event) => event.stopPropagation()}
                            >
                                {/* The reveal is the wrapper's, not each button's. */}
                                <RowActionButton
                                    label={vm.isPinned ? "Unpin session" : "Pin session"}
                                    onClick={() => onTogglePin(vm.id)}
                                >
                                    {/* Pin and unpin as ONE control: a pinned row keeps the same
                                        pin, filled. A separate unpin glyph made the pinned state
                                        look like a fault to undo. */}
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

            {!showAgent ? null : vm.agentId ? (
                <span className={cn("flex min-w-0 items-center gap-1.5", archived && FADED)}>
                    {/* The agent's own mark, not a generic robot — the same tile the automations
                        table and the agent picker draw. */}
                    <AgentChip workflowId={vm.agentId} box="size-5" glyph={13} />
                    <SessionAgentName agentId={vm.agentId} />
                </span>
            ) : (
                <SessionAgentName agentId={null} />
            )}

            <span className={cn("truncate text-right text-[13px] text-muted-foreground", archived && FADED)}>
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
