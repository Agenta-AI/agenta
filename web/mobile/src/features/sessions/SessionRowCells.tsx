import {useCallback, useMemo, type MouseEvent as ReactMouseEvent} from "react"

import {AgentChip} from "@agenta/entity-ui/agent"
import type {SessionRowStatusMeta, SessionRowVm} from "@agenta/sessions/row"
import {
    InlineRenameInput,
    SessionAgentName,
    SessionPinButton,
    useInlineRename,
    type SessionMenuEntry,
} from "@agenta/sessions-ui"
import {timeAgo} from "@agenta/shared/utils"
import {PencilSimple} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

import {SessionRowMenu} from "./SessionRowMenu"

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
    entries,
    onMenuSelect,
    onRenameRow,
    onTogglePin,
}: {
    vm: SessionRowVm
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
            <span className="flex min-w-0 items-center gap-2">
                <StatusDot status={vm.status} />
                {rename.renaming ? (
                    <span className="min-w-0 flex-1" onClick={swallow}>
                        <InlineRenameInput rename={rename} />
                    </span>
                ) : (
                    <>
                        <span className="min-w-0 truncate text-[14px] text-foreground" title={vm.title}>
                            {vm.title}
                        </span>
                        {archived ? null : (
                            <span
                                className="flex shrink-0 items-center gap-1"
                                onClick={swallow}
                                onKeyDown={(event) => event.stopPropagation()}
                            >
                                <SessionPinButton
                                    pinned={vm.isPinned}
                                    onToggle={() => onTogglePin(vm.id)}
                                    revealOnHover={false}
                                />
                                {/* The pin's twin: same glyph size and the same transparent hit
                                    extender, so the pair reads as one control group and both are
                                    thumb-sized without growing the row. */}
                                <button
                                    type="button"
                                    aria-label="Rename session"
                                    onClick={rename.start}
                                    className="relative shrink-0 cursor-pointer border-0 bg-transparent p-0 text-colorTextTertiary after:absolute after:inset-[-12px] after:content-[''] [@media(hover:hover)]:after:inset-[-6px]"
                                >
                                    <PencilSimple size={14} />
                                </button>
                            </span>
                        )}
                    </>
                )}
            </span>

            {vm.agentId ? (
                <span className="flex min-w-0 items-center gap-1.5">
                    {/* The agent's own mark, not a generic robot — the same tile the automations
                        table and the agent picker draw. */}
                    <AgentChip workflowId={vm.agentId} box="size-5" glyph={13} />
                    <SessionAgentName agentId={vm.agentId} />
                </span>
            ) : (
                <SessionAgentName agentId={null} />
            )}

            <span className="truncate text-[13px] text-muted-foreground">{updated}</span>

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
