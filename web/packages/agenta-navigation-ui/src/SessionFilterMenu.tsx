import {useCallback, useMemo, useRef, useState, type KeyboardEvent} from "react"

import {
    DEFAULT_SIDEBAR_SESSION_FILTERS,
    sidebarSessionAgentOptionsAtomFamily,
    sidebarSessionFiltersAtomFamily,
    sidebarSessionFiltersDirtyAtomFamily,
    type SidebarSessionActivityFilter,
    type SidebarSessionGroupBy,
    type SidebarSessionStatusFilter,
} from "@agenta/navigation"
import {
    FILTER_MENU_FLIP_WIDTH,
    FilterMenu,
    type FilterMenuFacet,
    type FilterMenuToggle,
} from "@agenta/ui/components/presentational"
import {
    ArchiveIcon,
    ClockIcon,
    FadersHorizontalIcon,
    ListBulletsIcon,
    PulseIcon,
    PushPinIcon,
    RobotIcon,
} from "@phosphor-icons/react"
import {useAtom, useAtomValue} from "jotai"

const GROUP_BY_OPTIONS = [
    {value: "agent", label: "Agent"},
    {value: "date", label: "Date"},
    {value: "status", label: "Status"},
    {value: "pinned", label: "Pinned first"},
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
                defaultValue: "agent",
                options: GROUP_BY_OPTIONS,
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
                options: agentOptions,
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
                defaultValue: "all",
                options: ACTIVITY_OPTIONS,
            },
        ],
        [agentOptions, filters.activity, filters.agentIds, filters.groupBy, filters.status],
    )

    const toggles = useMemo<FilterMenuToggle[]>(
        () => [
            {
                key: "pinnedOnly",
                label: "Pinned only",
                on: filters.pinnedOnly,
                icon: <PushPinIcon size={14} />,
            },
            {
                key: "archivedOnly",
                label: "Archived only",
                on: filters.archivedOnly,
                icon: <ArchiveIcon size={14} />,
            },
        ],
        [filters.pinnedOnly, filters.archivedOnly],
    )

    const onFacetChange = useCallback(
        (key: string, value: string) => {
            if (key === "status") setFilters({status: value as SidebarSessionStatusFilter})
            if (key === "groupBy") setFilters({groupBy: value as SidebarSessionGroupBy})
            if (key === "activity") setFilters({activity: value as SidebarSessionActivityFilter})
        },
        [setFilters],
    )

    const onFacetToggle = useCallback(
        (key: string, value: string, on: boolean) => {
            if (key !== "agentIds") return
            setFilters({
                agentIds: on
                    ? [...filters.agentIds, value]
                    : filters.agentIds.filter((id) => id !== value),
            })
        },
        [filters.agentIds, setFilters],
    )

    const onToggleChange = useCallback(
        (key: string, on: boolean) => setFilters({[key]: on}),
        [setFilters],
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
            toggles={toggles}
            dirty={dirty}
            onFacetChange={onFacetChange}
            onFacetToggle={onFacetToggle}
            onToggleChange={onToggleChange}
            onReset={onReset}
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
                className="relative mr-1 flex h-[22px] w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-colorTextTertiary [font-family:inherit] hover:bg-colorFillTertiary hover:text-colorText"
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
                {dirty ? (
                    <span className="absolute right-0 top-0 h-[5px] w-[5px] rounded-full bg-colorPrimary" />
                ) : null}
            </button>
        </FilterMenu>
    )
}
