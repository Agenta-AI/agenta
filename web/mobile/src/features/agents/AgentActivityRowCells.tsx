import {useCallback, useMemo, type MouseEvent as ReactMouseEvent} from "react"

import {useT} from "@agenta/i18n"
import agentsActivity from "@agenta/i18n/catalogs/agents.activity"
import {
    sessionAutomationKindLabel,
    type SessionRowStatusMeta,
    type SessionRowVm,
} from "@agenta/sessions/row"
import {InlineRenameInput, useInlineRename, type SessionMenuEntry} from "@agenta/sessions-ui"
import {timeAgo} from "@agenta/shared/utils"
import {CalendarBlank, Lightning} from "@phosphor-icons/react"

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
                "box-border size-2 shrink-0 rounded-xs border border-solid",
                live ? `${status.dotClassName} border-transparent` : "border-border",
            )}
        />
    )
}

/** A run's tile: the automations page's kind mark, a bolt for an event and a calendar for a schedule. */
const RunTile = ({vm}: {vm: SessionRowVm}) => {
    const t = useT(agentsActivity)
    // A run whose trigger record is gone still ran from one; the neutral tile says "a run".
    const kind = vm.automation?.kind ?? null
    return (
        <span
            role="img"
            aria-label={`${kind ? sessionAutomationKindLabel(kind) : t("agents.activity.automationRun")} · ${vm.status.label}`}
            title={vm.status.label}
            className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground"
        >
            {kind === "schedule" ? (
                <CalendarBlank size={14} aria-hidden />
            ) : (
                <Lightning size={14} aria-hidden />
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
    const t = useT(agentsActivity)
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
                            className="h-6 w-full min-w-0 rounded-md border border-solid border-border bg-background px-2 text-body leading-none text-foreground outline-none transition-colors [font-family:inherit] selection:bg-primary selection:text-primary-foreground focus-ring-field"
                        />
                    </span>
                ) : (
                    <span className="min-w-0 truncate text-body text-foreground" title={vm.title}>
                        {vm.title}
                    </span>
                )}
            </span>

            <span
                className={cn(
                    "truncate text-right text-label text-muted-foreground",
                    archived && FADED,
                )}
            >
                {updated}
            </span>

            <span className="flex justify-end" onClick={swallow}>
                <SessionRowMenu
                    entries={entries}
                    onSelect={onSelect}
                    label={vm.title || t("agents.activity.untitledSession")}
                />
            </span>
        </>
    )
}
