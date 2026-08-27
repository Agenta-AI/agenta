import {useCallback, useMemo, useRef, useState, type KeyboardEvent} from "react"

import {
    DEFAULT_SIDEBAR_SESSION_FILTERS,
    sidebarSessionAgentOptionsAtomFamily,
    sidebarSessionFiltersAtomFamily,
    sidebarSessionFiltersDirtyAtomFamily,
    type SidebarSessionActivityFilter,
    type SidebarSessionGroupBy,
    type SidebarSessionStatusFilter,
    type SidebarSessionTypeFilter,
} from "@agenta/navigation"
import {
    FILTER_MENU_FLIP_WIDTH,
    FilterMenu,
    type FilterMenuFacet,
} from "@agenta/ui/components/presentational"
import {
    ClockIcon,
    FadersHorizontalIcon,
    LightningIcon,
    ListBulletsIcon,
    PulseIcon,
    RobotIcon,
} from "@phosphor-icons/react"
import {useAtom, useAtomValue} from "jotai"

/** The "back to all" row. Never a real workflow id, so it cannot collide with one. */
const ALL_AGENTS = "__all__"

const GROUP_BY_OPTIONS = [
    {value: "none", label: "None"},
    {value: "agent", label: "Agent"},
    {value: "date", label: "Date"},
    {value: "status", label: "Status"},
]

const TYPE_OPTIONS = [
    {value: "all", label: "All"},
    {value: "chat", label: "Chat"},
    {value: "automation", label: "Automation"},
]

const STATUS_OPTIONS = [
    {value: "all", label: "All"},
    {value: "running", label: "Running"},
    {value: "waiting", label: "Awaiting input"},
    {value: "idle", label: "Idle"},
]

const ACTIVITY_OPTIONS = [
    {value: "all", label: "All"},
    {value: "24h", label: "Today"},
    {value: "7d", label: "Last 7 days"},
    {value: "30d", label: "Last 30 days"},
]

/**
 * Filters for the sidebar's Sessions group, on the group row itself.
 *
 * Every option here is a server predicate — narrowing the fetched page in the browser would
 * filter the window rather than the set, and get the empty state wrong.
 */
export const SessionFilterMenu = ({scopeId}: {scopeId: string}) => {
    const filtersAtom = useMemo(() => sidebarSessionFiltersAtomFamily(scopeId), [scopeId])
    const [filters, setFilters] = useAtom(filtersAtom)
    const dirty = useAtomValue(sidebarSessionFiltersDirtyAtomFamily(scopeId))
    const agentOptions = useAtomValue(sidebarSessionAgentOptionsAtomFamily(scopeId))

    const facets = useMemo<FilterMenuFacet[]>(
        () => [
            {
                key: "groupBy",
                label: "Group by",
                icon: <ListBulletsIcon size={14} />,
                value: filters.groupBy,
                defaultValue: "none",
                options: GROUP_BY_OPTIONS,
            },
            {
                key: "type",
                label: "Type",
                // A bolt, not the robot: the robot means AGENT throughout the rail, and an
                // automation is a trigger that ran one — reusing it would conflate the two.
                icon: <LightningIcon size={14} />,
                value: filters.type,
                defaultValue: "chat",
                options: TYPE_OPTIONS,
            },
            {
                key: "agentIds",
                label: "Agent",
                icon: <RobotIcon size={14} />,
                // The one multi-choice facet: narrowing to two teammates' agents is a real
                // question, where two statuses or two date windows are not.
                multiple: true,
                values: filters.agentIds,
                emptyLabel: "All agents",
                manyLabel: (count) => `${count} agents`,
                // Empty already means every agent; this makes it a row you can pick, checked by
                // default, so there is a way back to all without deselecting each one.
                noneValue: ALL_AGENTS,
                options: [{value: ALL_AGENTS, label: "All agents"}, ...agentOptions],
            },
            {
                key: "status",
                label: "Status",
                icon: <PulseIcon size={14} />,
                value: filters.status,
                defaultValue: "all",
                options: STATUS_OPTIONS,
            },
            {
                key: "activity",
                label: "Last activity",
                icon: <ClockIcon size={14} />,
                value: filters.activity,
                defaultValue: "7d",
                options: ACTIVITY_OPTIONS,
            },
        ],
        [
            agentOptions,
            filters.activity,
            filters.agentIds,
            filters.groupBy,
            filters.status,
            filters.type,
        ],
    )

    const onFacetChange = useCallback(
        (key: string, value: string) => {
            if (key === "status") setFilters({status: value as SidebarSessionStatusFilter})
            if (key === "groupBy") setFilters({groupBy: value as SidebarSessionGroupBy})
            if (key === "activity") setFilters({activity: value as SidebarSessionActivityFilter})
            if (key === "type") setFilters({type: value as SidebarSessionTypeFilter})
        },
        [setFilters],
    )

    const onFacetToggle = useCallback(
        (key: string, value: string, on: boolean) => {
            if (key !== "agentIds") return
            if (value === ALL_AGENTS) {
                setFilters({agentIds: []})
                return
            }
            setFilters({
                agentIds: on
                    ? [...filters.agentIds, value]
                    : filters.agentIds.filter((id) => id !== value),
            })
        },
        [filters.agentIds, setFilters],
    )

    const triggerRef = useRef<HTMLButtonElement>(null)
    const [align, setAlign] = useState<"start" | "end">("end")

    // The rail is resizable, so an end-aligned menu runs off the left edge once the rail is
    // narrower than the menu. Flip to start-aligned there and let it overhang the content area
    // instead, which is empty space. Measured on open rather than on resize: the rail can only
    // be dragged while the menu is closed.
    const measureAlign = useCallback(() => {
        const right = triggerRef.current?.getBoundingClientRect().right ?? 0
        setAlign(right < FILTER_MENU_FLIP_WIDTH ? "start" : "end")
    }, [])

    // Radix also opens on Enter, Space and ArrowDown, and a keyboard user in a narrow rail needs
    // the same flip a pointer user gets.
    const onTriggerKeyDown = useCallback(
        (event: KeyboardEvent<HTMLButtonElement>) => {
            if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
                measureAlign()
            }
        },
        [measureAlign],
    )

    const onReset = useCallback(() => setFilters(DEFAULT_SIDEBAR_SESSION_FILTERS), [setFilters])

    return (
        <FilterMenu
            facets={facets}
            dirty={dirty}
            onReset={onReset}
            onFacetChange={onFacetChange}
            onFacetToggle={onFacetToggle}
            // Anchored, not collision-flipped: the rail is narrow enough that Radix would
            // otherwise move the menu somewhere different depending on scroll position. The side
            // it anchors to comes from `measureAlign` instead.
            align={align}
            avoidCollisions={false}
        >
            <button
                ref={triggerRef}
                type="button"
                aria-label="Filter sessions"
                // [font-family:inherit]: preflight is off, so a bare <button> renders Arial.
                className="mr-1 flex h-[22px] w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-colorTextTertiary [font-family:inherit] hover:bg-colorFillTertiary hover:text-colorText"
                // Radix opens on pointer down, so the measurement has to land in the same
                // event — by click the menu is already positioned.
                onPointerDown={measureAlign}
                onKeyDown={onTriggerKeyDown}
                onClick={(event) => {
                    // The group row's link anchor is stretched over the whole row.
                    event.preventDefault()
                    event.stopPropagation()
                }}
            >
                <FadersHorizontalIcon size={14} />
            </button>
        </FilterMenu>
    )
}
