import {useCallback, useMemo, type MouseEvent as ReactMouseEvent} from "react"

import {
    sessionAutomationKindLabel,
    type SessionRowStatusMeta,
    type SessionRowVm,
} from "@agenta/sessions/row"
import {InlineRenameInput, useInlineRename, type SessionMenuEntry} from "@agenta/sessions-ui"
import {timeAgo} from "@agenta/shared/utils"
import {ClockClockwise, Lightning} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

import {SessionRowMenu} from "../sessions/SessionRowMenu"

/** Archived is a state the reader chose. The kebab keeps full weight; unarchiving lives there. */
const FADED = "opacity-60"

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

/** The automations page's two tints: orange for "when something happens", purple for a schedule. */
const KIND_CHIP: Record<"subscription" | "schedule", string> = {
    subscription: "bg-[var(--ag-preset-orange-bg)] text-[var(--ag-preset-orange-text)]",
    schedule: "bg-[var(--ag-preset-purple-bg)] text-[var(--ag-preset-purple-text)]",
}

/** A run's tile: the automations page's kind mark, a bolt for an event and a clock for a schedule. */
const RunTile = ({vm}: {vm: SessionRowVm}) => {
    // A run whose trigger record is gone still ran from one; the neutral tile says "a run".
    const kind = vm.automation?.kind ?? null
    return (
        <span
            role="img"
            aria-label={`${kind ? sessionAutomationKindLabel(kind) : "Automation run"} · ${vm.status.label}`}
            title={vm.status.label}
            className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md",
                kind ? KIND_CHIP[kind] : "bg-muted text-muted-foreground",
            )}
        >
            {kind === "schedule" ? (
                <ClockClockwise size={13} aria-hidden />
            ) : (
                <Lightning size={13} aria-hidden />
            )}
        </span>
    )
}

/**
 * One activity row's cells, in column order: the mark, the title (or its rename editor), the
 * time, the kebab. The sessions page's narrow row, with a run tile where the tab is runs.
 */
export const AgentActivityRowCells = ({
    vm,
    entries,
    onMenuSelect,
    onRenameRow,
}: {
    vm: SessionRowVm
    entries: SessionMenuEntry[]
    onMenuSelect: (vm: SessionRowVm, key: string) => void
    onRenameRow: (vm: SessionRowVm, name: string) => Promise<boolean>
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

    const archived = Boolean(vm.stream.archived_at)
    const updated = useMemo(
        () => (vm.activityAt ? timeAgo(Date.parse(vm.activityAt)) : "—"),
        [vm.activityAt],
    )

    return (
        <>
            <span className={cn("flex min-w-0 items-center gap-2.5", archived && FADED)}>
                {vm.isAutomation ? <RunTile vm={vm} /> : <StatusDot status={vm.status} />}
                {rename.renaming ? (
                    <span className="min-w-0 flex-1" onClick={swallow}>
                        <InlineRenameInput
                            rename={rename}
                            className="h-6 w-full min-w-0 rounded-md border border-solid border-input bg-background px-2 text-[14px] leading-none text-foreground shadow-xs outline-none transition-[color,box-shadow] [font-family:inherit] selection:bg-primary selection:text-primary-foreground focus:border-ring focus:ring-[3px] focus:ring-ring/50 dark:bg-input/30"
                        />
                    </span>
                ) : (
                    <span className="min-w-0 truncate text-[14px] text-foreground" title={vm.title}>
                        {vm.title}
                    </span>
                )}
            </span>

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
