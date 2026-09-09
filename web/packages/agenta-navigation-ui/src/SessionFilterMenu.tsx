import {useCallback, useMemo} from "react"

import {
    clearSidebarManualOrderAtom,
    DEFAULT_SIDEBAR_SESSION_FILTERS,
    SESSIONS_SIDEBAR_KEY,
    setSidebarFilterMenuOpenAtom,
    sidebarSessionAgentOptionsAtomFamily,
    sidebarSessionAgentOptionsPendingAtomFamily,
    sidebarSessionFiltersAtomFamily,
    sidebarHasAnySessionAtomFamily,
    sidebarSessionMenuDirtyAtomFamily,
    type SidebarSessionActivityFilter,
    type SidebarSessionGroupBy,
    type SidebarSessionStatusFilter,
    type SidebarSessionTypeFilter,
} from "@agenta/navigation"
import {FilterMenu, type FilterMenuSection} from "@agenta/ui/filter-menu"
import {
    ClockIcon,
    FadersHorizontalIcon,
    LightningIcon,
    ListBulletsIcon,
    PulseIcon,
    RobotIcon,
} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

/** The "back to all" row. Never a real workflow id, so it cannot collide with one. */
const ALL_AGENTS = "__all__"

const ICON = 14

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
 *
 * The panel is the shared `@agenta/ui/filter-menu`, the same one the automations list opens, so a
 * row, a flyout and a check mark are drawn once for the whole product. Only this surface's
 * meaning lives here.
 */
export const SessionFilterMenu = ({scopeId}: {scopeId: string}) => {
    const filtersAtom = useMemo(() => sidebarSessionFiltersAtomFamily(scopeId), [scopeId])
    const [filters, setFilters] = useAtom(filtersAtom)
    const dirty = useAtomValue(sidebarSessionMenuDirtyAtomFamily(scopeId))
    const clearManualOrder = useSetAtom(clearSidebarManualOrderAtom)
    // Both read gated atoms: until this menu reports itself open they return empty without
    // touching the agent catalog, which is what keeps the catalog off every sidebar mount.
    const agentOptions = useAtomValue(sidebarSessionAgentOptionsAtomFamily(scopeId))
    const agentOptionsPending = useAtomValue(sidebarSessionAgentOptionsPendingAtomFamily(scopeId))
    const setFilterMenuOpen = useSetAtom(setSidebarFilterMenuOpenAtom)
    const onOpenChange = useCallback(
        (open: boolean) => setFilterMenuOpen({scopeId, key: SESSIONS_SIDEBAR_KEY, open}),
        [scopeId, setFilterMenuOpen],
    )
    const sessions = useAtomValue(sidebarHasAnySessionAtomFamily(scopeId))

    // Empty already means every agent, so the summary has to say so rather than reading blank.
    const agentLabel = useMemo(() => {
        if (filters.agentIds.length === 0) return "All agents"
        if (filters.agentIds.length === 1) {
            const only = agentOptions.find((option) => option.value === filters.agentIds[0])
            if (only) return only.label
        }
        return `${filters.agentIds.length} agents`
    }, [agentOptions, filters.agentIds])

    const toggleAgent = useCallback(
        (value: string) => {
            // The "All agents" row is a way back to everything, not an agent to select.
            if (value === ALL_AGENTS) {
                setFilters({agentIds: []})
                return
            }
            setFilters({
                agentIds: filters.agentIds.includes(value)
                    ? filters.agentIds.filter((id) => id !== value)
                    : [...filters.agentIds, value],
            })
        },
        [filters.agentIds, setFilters],
    )

    const sections = useMemo<FilterMenuSection[]>(
        () => [
            // Grouping sits with the filters rather than under the panel's sort divider: on this
            // surface it is the first question, and the rail has no sort to divide it from.
            {
                key: "groupBy",
                label: "Group by",
                icon: <ListBulletsIcon size={ICON} />,
                value: filters.groupBy,
                options: GROUP_BY_OPTIONS,
                onChange: (value) => setFilters({groupBy: value as SidebarSessionGroupBy}),
            },
            {
                key: "type",
                label: "Type",
                // A bolt, not the robot: the robot means AGENT throughout the rail, and an
                // automation is a trigger that ran one — reusing it would conflate the two.
                icon: <LightningIcon size={ICON} />,
                value: filters.type,
                options: TYPE_OPTIONS,
                onChange: (value) => setFilters({type: value as SidebarSessionTypeFilter}),
            },
            {
                key: "agentIds",
                label: "Agent",
                icon: <RobotIcon size={ICON} />,
                // The one multi-choice row: narrowing to two teammates' agents is a real
                // question, where two statuses or two date windows are not.
                multi: true,
                // Empty MEANS every agent, so the row that says so has to carry the check —
                // otherwise the panel's only "all agents" state is the one with nothing ticked.
                value: filters.agentIds.length ? filters.agentIds : [ALL_AGENTS],
                valueLabel: agentLabel,
                options: [{value: ALL_AGENTS, label: "All agents"}, ...agentOptions],
                // The catalog only starts loading when this menu opens, so the facet is briefly
                // empty. Say so, rather than let it read as "this project has no agents".
                emptyText: agentOptionsPending ? "Loading agents…" : "No agents yet",
                onChange: toggleAgent,
            },
            {
                key: "status",
                label: "Status",
                icon: <PulseIcon size={ICON} />,
                value: filters.status,
                options: STATUS_OPTIONS,
                onChange: (value) => setFilters({status: value as SidebarSessionStatusFilter}),
            },
            {
                key: "activity",
                label: "Last activity",
                icon: <ClockIcon size={ICON} />,
                value: filters.activity,
                options: ACTIVITY_OPTIONS,
                onChange: (value) => setFilters({activity: value as SidebarSessionActivityFilter}),
            },
        ],
        [
            agentLabel,
            agentOptions,
            agentOptionsPending,
            filters.activity,
            filters.agentIds,
            filters.groupBy,
            filters.status,
            filters.type,
            setFilters,
            toggleAgent,
        ],
    )

    // Clears the arrangement alongside the filters: both are defaults this menu set.
    const onReset = useCallback(() => {
        setFilters(DEFAULT_SIDEBAR_SESSION_FILTERS)
        clearManualOrder()
    }, [clearManualOrder, setFilters])

    // Below every hook, not above. Hidden only when the PROJECT holds no session at all: the
    // defaults narrow to chat within 7 days, so a rail emptied by them still needs this control
    // to widen them again, and `dirty` reads false in exactly that case. Not while pending
    // either, or the control pops in after every load.
    if (!sessions.pending && !sessions.any && !dirty) return null

    return (
        // The trigger belongs to the shared menu, so the one rail-specific behaviour it needs is
        // handled here on the way past. Bubble phase, and stop only: Radix toggles the panel from
        // the trigger's own click, so capturing here swallowed the open. This just keeps the
        // click off the group row's stretched link anchor.
        <span className="flex items-center" onClick={(event) => event.stopPropagation()}>
            <FilterMenu
                sections={sections}
                // Reports open/closed to the gated agent catalog above.
                onOpenChange={onOpenChange}
                label={null}
                triggerAriaLabel="Filter sessions"
                icon={<FadersHorizontalIcon size={ICON} />}
                variant="ghost"
                // The rail's own control geometry, not the toolbar button's: a 22px square on a
                // 26px group row. Square, so its hover fill reads as one hit area rather than a
                // wide slab behind a small glyph.
                triggerClassName="mr-1 size-[22px] p-0 text-colorTextTertiary hover:text-colorText"
                // No applied-dot here, unlike the automations toolbar: this trigger is 22px on a
                // 26px group row beside the search glyph, and a dot in its corner read as a
                // status on the Sessions row rather than as a state of the control.
                onReset={onReset}
                resetDisabled={!dirty}
                // Start-aligned, always: the panel is wider than the rail, so anchoring it to the
                // trigger's right edge ran it off the left of the screen. It overhangs the
                // content area instead, which is empty space beside a nav.
                align="start"
            />
        </span>
    )
}
