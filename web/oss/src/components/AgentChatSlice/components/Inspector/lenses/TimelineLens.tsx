/**
 * TimelineLens (build-spec §4.1) — the default lens; absorbs the old Timeline + Records +
 * Interactions tabs. Records-backed (cross-device). Session scope: turns as collapsible groups;
 * Turn scope: one turn, flat + expanded. Density Readable (labelled events) / Indexed (flat list).
 * Filter All / Tools / Interactions (badge = interaction count).
 */
import {useMemo, useState} from "react"

import {sessionRecordsQueryFamily} from "@agenta/entities/session"
import {CaretRight} from "@phosphor-icons/react"
import {Badge, Segmented, Skeleton} from "antd"
import {useAtom, useAtomValue} from "jotai"

import {EventList} from "../EventRow"
import {
    inspectorDensityAtom,
    inspectorFilterAtom,
    type InspectorScope,
    type TimelineFilter,
} from "../state"
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

const TurnGroupCard = ({group, defaultOpen}: {group: TurnGroup; defaultOpen: boolean}) => {
    const [open, setOpen] = useState(defaultOpen)
    const statusColor =
        group.status === "error" ? "#f0857c" : group.status === "running" ? "#e0b050" : "#8fd07a"
    return (
        <div className="border-0 border-b border-solid border-[#24262b]">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-2 py-2 text-left hover:bg-[#212327]"
            >
                <CaretRight
                    size={11}
                    weight="bold"
                    className={`shrink-0 text-colorTextTertiary transition-transform ${open ? "rotate-90" : ""}`}
                />
                <span className="text-xs font-medium">Turn {group.turn}</span>
                <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{background: statusColor}}
                />
                <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[10px] text-colorTextQuaternary">
                    {group.startAt != null ? <span>{formatWallClock(group.startAt)}</span> : null}
                    {turnTotal(group) ? <span>· {turnTotal(group)}</span> : null}
                    <span>· {group.events.length} events</span>
                </span>
            </button>
            {open ? (
                <div className="border-0 border-t border-solid border-[#24262b] pl-2">
                    <EventList events={group.events} turnStart={group.startAt} />
                </div>
            ) : null}
        </div>
    )
}

export function TimelineLens({
    sessionId,
    scope,
    targetTurn,
}: {
    sessionId: string
    scope: InspectorScope
    targetTurn?: number | null
}) {
    const query = useAtomValue(sessionRecordsQueryFamily(sessionId))
    const [filter, setFilter] = useAtom(inspectorFilterAtom)
    const [density, setDensity] = useAtom(inspectorDensityAtom)

    const {turns, filteredFlat, interactionCount} = useMemo(() => {
        const {events, turns} = buildTimeline(query.data)
        const scoped =
            scope === "turn" && targetTurn != null
                ? turns.filter((t) => t.turn === targetTurn)
                : turns
        const flat = scoped.flatMap((t) => t.events).filter((e) => matchesFilter(e, filter))
        const interactions = events.filter((e) => e.type === "interaction_request").length
        const filteredTurns = scoped
            .map((t) => ({...t, events: t.events.filter((e) => matchesFilter(e, filter))}))
            .filter((t) => t.events.length > 0)
        return {turns: filteredTurns, filteredFlat: flat, interactionCount: interactions}
    }, [query.data, scope, targetTurn, filter])

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
    // Turn scope OR Indexed density = one flat list; Readable + Session = grouped turns.
    const flatMode = scope === "turn" || density === "indexed"

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-[#2a2c30] px-2 py-1.5">
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
                                            style={{background: "#e0b050", color: "#0f1012"}}
                                        />
                                    ) : null}
                                </span>
                            ),
                            value: "interactions",
                        },
                    ]}
                />
                <div className="ml-auto">
                    <Segmented
                        value={density}
                        onChange={(v) => setDensity(v as typeof density)}
                        options={[
                            {label: "Readable", value: "readable"},
                            {label: "Indexed", value: "indexed"},
                        ]}
                    />
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {empty ? (
                    <div className="p-6 text-center text-xs text-colorTextTertiary">
                        {filter === "interactions"
                            ? "No interactions in this " + (scope === "turn" ? "turn." : "session.")
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
                        />
                    ))
                )}
            </div>
        </div>
    )
}
