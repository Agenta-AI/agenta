/**
 * TimelineLens (build-spec §4.1) — the default lens; absorbs the old Timeline + Records +
 * Interactions tabs. Records-backed (cross-device). Reacts to the panel scope selector: Session =
 * all turns as collapsible groups; a focused turn = that turn's events, flat + expanded. Filter
 * All / Tools / Interactions (badge = count in the current scope).
 */
import {useMemo, useState} from "react"

import {sessionRecordsQueryFamily} from "@agenta/entities/session"
import {CaretRight} from "@phosphor-icons/react"
import {Badge, Segmented, Skeleton, Tooltip} from "antd"
import {useAtom, useAtomValue} from "jotai"

import {EventList} from "../EventRow"
import {inspectorFilterAtom, type TimelineFilter} from "../state"
import {
    buildTimeline,
    formatWallClock,
    toolDuration,
    type TimelineEvent,
    type TurnGroup,
} from "../timeline"

const matchesFilter = (e: TimelineEvent, filter: TimelineFilter): boolean => {
    if (filter === "all") return true
    if (filter === "tools") return e.type === "tool_call" || e.type === "tool_result"
    return e.type === "interaction_request"
}

const turnTotal = (group: TurnGroup): string =>
    group.startAt != null && group.endAt != null
        ? toolDuration(group.startAt, group.endAt) || "0ms"
        : ""

const TurnGroupCard = ({
    group,
    defaultOpen,
    onFocus,
}: {
    group: TurnGroup
    defaultOpen: boolean
    onFocus?: (turn: number) => void
}) => {
    const [open, setOpen] = useState(defaultOpen)
    const statusColor =
        group.status === "error"
            ? "var(--ag-colorError)"
            : group.status === "running"
              ? "var(--ag-colorWarning)"
              : "var(--ag-colorSuccess)"
    return (
        <div className="border-0 border-b border-solid border-colorSplit">
            {/* Caret toggles expand; the header body FOCUSES the turn (scopes the whole panel to it). */}
            <div className="flex w-full items-center gap-2 px-2 py-2 hover:bg-colorFillTertiary">
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="shrink-0 cursor-pointer border-0 bg-transparent p-0"
                    aria-label={open ? "Collapse turn" : "Expand turn"}
                >
                    <CaretRight
                        size={11}
                        weight="bold"
                        className={`text-colorTextTertiary transition-transform ${open ? "rotate-90" : ""}`}
                    />
                </button>
                <button
                    type="button"
                    onClick={() => (onFocus ? onFocus(group.turn) : setOpen((v) => !v))}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left"
                    title={onFocus ? "Focus this turn" : undefined}
                >
                    <span className="text-xs font-medium">Turn {group.turn}</span>
                    <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{background: statusColor}}
                    />
                    <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[10px] text-colorTextQuaternary">
                        {group.startAt != null ? (
                            <span>{formatWallClock(group.startAt)}</span>
                        ) : null}
                        {turnTotal(group) ? <span>· {turnTotal(group)}</span> : null}
                        <span>· {group.events.length} events</span>
                    </span>
                </button>
            </div>
            {open ? (
                <div className="border-0 border-t border-solid border-colorSplit pl-2">
                    <EventList events={group.events} turnStart={group.startAt} />
                </div>
            ) : null}
        </div>
    )
}

export function TimelineLens({
    sessionId,
    focusedTurn,
    onDrillTurn,
}: {
    sessionId: string
    focusedTurn?: number | null
    onDrillTurn?: (turn: number) => void
}) {
    const query = useAtomValue(sessionRecordsQueryFamily(sessionId))
    const [filter, setFilter] = useAtom(inspectorFilterAtom)

    const {turns, filteredFlat, interactionCount} = useMemo(() => {
        const {turns} = buildTimeline(query.data)
        // Scope to the focused turn (if any), then filter within it.
        const scoped = focusedTurn != null ? turns.filter((t) => t.turn === focusedTurn) : turns
        const scopedEvents = scoped.flatMap((t) => t.events)
        const flat = scopedEvents.filter((e) => matchesFilter(e, filter))
        const interactions = scopedEvents.filter((e) => e.type === "interaction_request").length
        const filteredTurns = scoped
            .map((t) => ({...t, events: t.events.filter((e) => matchesFilter(e, filter))}))
            .filter((t) => t.events.length > 0)
        return {turns: filteredTurns, filteredFlat: flat, interactionCount: interactions}
    }, [query.data, filter, focusedTurn])

    if (query.isPending)
        return (
            <div className="p-3">
                <Skeleton active paragraph={{rows: 8}} />
            </div>
        )
    if (query.data === null || query.isError)
        return (
            <div className="p-4 text-xs text-colorTextTertiary">Couldn&rsquo;t load records.</div>
        )

    const empty = filteredFlat.length === 0
    // A focused turn shows its events flat + expanded; the whole session shows turns as groups.
    const flatMode = focusedTurn != null

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-colorSplit px-2 py-1.5">
                <Tooltip
                    title="Filter events — all, only tool calls & results, or only interactions (approvals & inputs)."
                    placement="bottom"
                    mouseEnterDelay={0.4}
                >
                    <Segmented
                        value={filter}
                        onChange={(v) => setFilter(v as TimelineFilter)}
                        options={[
                            {label: "All", value: "all"},
                            {label: "Tools", value: "tools"},
                            {
                                label: (
                                    <span className="flex items-center gap-1.5">
                                        Interactions
                                        {interactionCount > 0 ? (
                                            <Badge
                                                count={interactionCount}
                                                size="small"
                                                style={{
                                                    background: "var(--ag-colorWarning)",
                                                    color: "var(--ag-colorTextLightSolid)",
                                                }}
                                            />
                                        ) : null}
                                    </span>
                                ),
                                value: "interactions",
                            },
                        ]}
                    />
                </Tooltip>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {empty ? (
                    <div className="p-6 text-center text-xs text-colorTextTertiary">
                        {filter === "interactions"
                            ? `No interactions in this ${focusedTurn != null ? "turn" : "session"}.`
                            : "No events yet."}
                    </div>
                ) : flatMode ? (
                    <EventList events={filteredFlat} turnStart={turns[0]?.startAt ?? null} />
                ) : (
                    turns.map((group) => (
                        <TurnGroupCard
                            key={group.turn}
                            group={group}
                            defaultOpen={turns.length <= 2 || group.status === "running"}
                            onFocus={onDrillTurn}
                        />
                    ))
                )}
            </div>
        </div>
    )
}
