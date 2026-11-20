import {useCallback, useMemo} from "react"

import {useT, type CatalogKey} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import sessionFilterCatalog from "@agenta/i18n/catalogs/shell.sessionFilter"
import {
    clearSidebarManualOrderAtom,
    sidebarSessionFilterDefaults,
    SESSIONS_SIDEBAR_KEY,
    setSidebarFilterMenuOpenAtom,
    sidebarSessionAgentOptionsAtomFamily,
    sidebarSessionAgentOptionsPendingAtomFamily,
    sidebarSessionFiltersAtomFamily,
    sidebarHasAnySessionAtomFamily,
    sidebarSessionFiltersDirtyAtomFamily,
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

type FilterTextKey = CatalogKey<typeof sessionFilterCatalog> | CatalogKey<typeof commonCatalog>

const GROUP_BY_OPTIONS: {value: string; labelKey: FilterTextKey}[] = [
    {value: "none", labelKey: "common.none"},
    {value: "agent", labelKey: "shell.sessionFilter.agent"},
    {value: "date", labelKey: "shell.sessionFilter.date"},
    {value: "status", labelKey: "common.status"},
]

const TYPE_OPTIONS: {value: string; labelKey: FilterTextKey}[] = [
    {value: "all", labelKey: "common.all"},
    {value: "chat", labelKey: "shell.sessionFilter.chat"},
    {value: "automation", labelKey: "shell.sessionFilter.automation"},
]

const STATUS_OPTIONS: {value: string; labelKey: FilterTextKey}[] = [
    {value: "all", labelKey: "common.all"},
    {value: "running", labelKey: "shell.sessionFilter.running"},
    {value: "waiting", labelKey: "shell.sessionFilter.awaitingInput"},
    {value: "idle", labelKey: "shell.sessionFilter.idle"},
]

const ACTIVITY_OPTIONS: {value: string; labelKey: FilterTextKey}[] = [
    {value: "all", labelKey: "common.all"},
    {value: "24h", labelKey: "shell.sessionFilter.today"},
    {value: "7d", labelKey: "shell.sessionFilter.last7Days"},
    {value: "30d", labelKey: "shell.sessionFilter.last30Days"},
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
/** The rows the menu can show, in its order. */
export type SessionFilterFacet = "groupBy" | "type" | "agentIds" | "status" | "activity"

const ALL_FACETS: readonly SessionFilterFacet[] = [
    "groupBy",
    "type",
    "agentIds",
    "status",
    "activity",
]

export const SessionFilterMenu = ({
    scopeId,
    facets = ALL_FACETS,
}: {
    scopeId: string
    /** The rows to show. A list that is one agent's has no Agent row and no Group by (the agent
     * sidebar); without Group by, Reset leaves the hand arrangement of the headings alone. */
    facets?: readonly SessionFilterFacet[]
}) => {
    const t = useT(sessionFilterCatalog, commonCatalog)
    const withLabels = useCallback(
        (options: {value: string; labelKey: FilterTextKey}[]) =>
            options.map(({value, labelKey}) => ({value, label: t(labelKey)})),
        [t],
    )
    const filtersAtom = useMemo(() => sidebarSessionFiltersAtomFamily(scopeId), [scopeId])
    const [filters, setFilters] = useAtom(filtersAtom)
    const arranges = facets.includes("groupBy")
    const menuDirty = useAtomValue(sidebarSessionMenuDirtyAtomFamily(scopeId))
    const filtersDirty = useAtomValue(sidebarSessionFiltersDirtyAtomFamily(scopeId))
    // The hand arrangement belongs to the menu that groups; another list's Reset keeps it.
    const dirty = arranges ? menuDirty : filtersDirty
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
        if (filters.agentIds.length === 0) return t("shell.sessionFilter.allAgents")
        if (filters.agentIds.length === 1) {
            const only = agentOptions.find((option) => option.value === filters.agentIds[0])
            if (only) return only.label
        }
        return t("shell.sessionFilter.agentCount", {count: filters.agentIds.length})
    }, [agentOptions, filters.agentIds, t])

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
        () =>
            (
                [
                    // Grouping sits with the filters rather than under the panel's sort divider: on this
                    // surface it is the first question, and the rail has no sort to divide it from.
                    {
                        key: "groupBy",
                        label: t("shell.sessionFilter.groupBy"),
                        icon: <ListBulletsIcon size={ICON} />,
                        value: filters.groupBy,
                        options: withLabels(GROUP_BY_OPTIONS),
                        onChange: (value) => setFilters({groupBy: value as SidebarSessionGroupBy}),
                    },
                    {
                        key: "type",
                        label: t("shell.sessionFilter.type"),
                        // A bolt, not the robot: the robot means AGENT throughout the rail, and an
                        // automation is a trigger that ran one — reusing it would conflate the two.
                        icon: <LightningIcon size={ICON} />,
                        value: filters.type,
                        options: withLabels(TYPE_OPTIONS),
                        onChange: (value) => setFilters({type: value as SidebarSessionTypeFilter}),
                    },
                    {
                        key: "agentIds",
                        label: t("shell.sessionFilter.agent"),
                        icon: <RobotIcon size={ICON} />,
                        // The one multi-choice row: narrowing to two teammates' agents is a real
                        // question, where two statuses or two date windows are not.
                        multi: true,
                        // Empty MEANS every agent, so the row that says so has to carry the check —
                        // otherwise the panel's only "all agents" state is the one with nothing ticked.
                        value: filters.agentIds.length ? filters.agentIds : [ALL_AGENTS],
                        valueLabel: agentLabel,
                        options: [
                            {value: ALL_AGENTS, label: t("shell.sessionFilter.allAgents")},
                            ...agentOptions,
                        ],
                        // The catalog only starts loading when this menu opens, so the facet is briefly
                        // empty. Say so, rather than let it read as "this project has no agents".
                        emptyText: agentOptionsPending
                            ? t("shell.sessionFilter.loadingAgents")
                            : t("shell.sessionFilter.noAgentsYet"),
                        wide: true,
                        onChange: toggleAgent,
                    },
                    {
                        key: "status",
                        label: t("common.status"),
                        icon: <PulseIcon size={ICON} />,
                        value: filters.status,
                        options: withLabels(STATUS_OPTIONS),
                        onChange: (value) =>
                            setFilters({status: value as SidebarSessionStatusFilter}),
                    },
                    {
                        key: "activity",
                        label: t("shell.sessionFilter.lastActivity"),
                        icon: <ClockIcon size={ICON} />,
                        value: filters.activity,
                        options: withLabels(ACTIVITY_OPTIONS),
                        onChange: (value) =>
                            setFilters({activity: value as SidebarSessionActivityFilter}),
                    },
                ] satisfies FilterMenuSection[]
            ).filter((section) => facets.includes(section.key as SessionFilterFacet)),
        [
            facets,
            agentLabel,
            agentOptions,
            agentOptionsPending,
            filters.activity,
            filters.agentIds,
            filters.groupBy,
            filters.status,
            filters.type,
            setFilters,
            t,
            toggleAgent,
            withLabels,
        ],
    )

    // Clears the arrangement alongside the filters: both are defaults this menu set.
    const onReset = useCallback(() => {
        setFilters(sidebarSessionFilterDefaults(scopeId))
        if (arranges) clearManualOrder()
    }, [arranges, clearManualOrder, scopeId, setFilters])

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
                triggerAriaLabel={t("shell.sessionFilter.filterSessions")}
                icon={<FadersHorizontalIcon size={ICON} />}
                variant="ghost"
                // The rail's own control geometry, not the toolbar button's: a 22px square on a
                // 28px group row. Square, so its hover fill reads as one hit area rather than a
                // wide slab behind a small glyph.
                triggerClassName="mr-1 size-[22px] p-0 text-colorTextTertiary hover:text-colorText"
                // No applied-dot here, unlike the automations toolbar: this trigger is 22px on a
                // 28px group row beside the search glyph, and a dot in its corner read as a
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
