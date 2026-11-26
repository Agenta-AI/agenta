import {useMemo, useRef, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import analyticsCatalog from "@agenta/i18n/catalogs/observabilityUi.analytics"
import {
    PATH,
    ANALYTICS_RANGES,
    isRangeLocked,
    keyedSeries,
    rankKeys,
    sum,
    analyticsModelProvidersAtomFamily,
    useAnalyticsViewAtoms,
    type AnalyticsCustomRange,
    type AnalyticsFilters,
    type AnalyticsGroup,
    type AnalyticsRangeKey,
    type AnalyticsRetention,
    type AnalyticsWindow,
} from "@agenta/observability/analytics"
import {
    FilterMenu,
    GroupMenu,
    type FilterMenuOption,
    type FilterMenuSection,
} from "@agenta/ui/filter-menu"
import {getProviderDisplayName, getProviderIcon} from "@agenta/ui/select-llm-provider"
import {
    Button,
    DateRangeCalendar,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Popover,
    PopoverAnchor,
    PopoverContent,
    type DateRangeValue,
} from "@agenta/ui/ui"
import {
    Cloud,
    Check,
    ClockCounterClockwise,
    ListBullets,
    LockSimple,
    Minus,
    Robot,
    Sparkle,
    X,
} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {useAgentNames, useAnalyticsBuckets} from "./useAnalyticsData"

type FilterDim = keyof AnalyticsFilters

const ICON = 14

const DIMS = [
    {
        key: "agent",
        label: "observabilityUi.analytics.dimAgent",
        all: "observabilityUi.analytics.allAgents",
        search: "observabilityUi.analytics.searchAgents",
        none: "observabilityUi.analytics.noAgentsInRange",
        icon: Robot,
    },
    {
        key: "model",
        label: "observabilityUi.analytics.dimModel",
        all: "observabilityUi.analytics.allModels",
        search: "observabilityUi.analytics.searchModels",
        none: "observabilityUi.analytics.noModelsInRange",
        icon: Sparkle,
    },
] as const satisfies readonly {
    key: FilterDim
    label: string
    all: string
    search: string
    none: string
    icon: typeof Robot
}[]

const RANGE_LABEL_KEYS = {
    "24h": "observabilityUi.analytics.rangeLast24h",
    "7d": "observabilityUi.analytics.rangeLast7d",
    "30d": "observabilityUi.analytics.rangeLast30d",
    "90d": "observabilityUi.analytics.rangeLast90d",
} as const

export interface AnalyticsToolbarProps {
    range: AnalyticsRangeKey
    onRangeChange: (range: AnalyticsRangeKey) => void
    custom: AnalyticsCustomRange | null
    onCustomChange: (range: AnalyticsCustomRange | null) => void
    rangeLabel: string
    retention: AnalyticsRetention | null
    onUpgrade?: () => void
    filters: AnalyticsFilters
    onFiltersChange: (filters: AnalyticsFilters) => void
    group: AnalyticsGroup
    onGroupChange: (group: AnalyticsGroup) => void
    window: AnalyticsWindow
    agentName: (id: string) => string
    rangeOpen: boolean
    onRangeOpenChange: (open: boolean) => void
    /** Shown on the page of one agent, where the Agent filter and grouping are not offered. */
    lockedAgentChip?: ReactNode
    /** What the charts read; the filter counts read it too, so they count this page's runs. */
    queryFilters?: AnalyticsFilters
}

export const AnalyticsToolbar = ({
    range,
    onRangeChange,
    custom,
    onCustomChange,
    rangeLabel,
    retention,
    onUpgrade,
    filters,
    onFiltersChange,
    group,
    onGroupChange,
    window,
    agentName,
    rangeOpen,
    onRangeOpenChange,
    lockedAgentChip,
    queryFilters = filters,
}: AnalyticsToolbarProps) => {
    // The view decides, as on the page: the page of one agent made its own view with that agent.
    const locked = Boolean(useAnalyticsViewAtoms().lockedAgentId)
    const t = useT(analyticsCatalog)
    const groupOptions: FilterMenuOption<AnalyticsGroup>[] = (
        locked
            ? (["none", "model", "provider"] as const)
            : (["none", "agent", "model", "provider"] as const)
    ).map((value) => ({value, label: t(GROUP_LABEL[value]), icon: GROUP_ICONS[value]}))
    // The locked agent shows as its own chip, never as a removable filter.
    const dims = locked ? DIMS.filter((d) => d.key !== "agent") : DIMS
    // The agent's own Analytics page draws its toolbar on the canvas scale (A09).
    const controlSize = locked ? "compact" : "sm"
    const active = dims.filter((d) => filters[d.key].length)
    const label = (dim: FilterDim, key: string) => (dim === "agent" ? agentName(key) : key)
    const [customOpen, setCustomOpen] = useState(false)
    const openingCustom = useRef(false)

    return (
        // The toolbar buttons (range, Filter, Group) are 44 px high on a phone, the touch size.
        <div className="flex flex-wrap items-center gap-2 max-md:[&>button]:h-11">
            <Popover open={customOpen} onOpenChange={setCustomOpen}>
                <DropdownMenu open={rangeOpen} onOpenChange={onRangeOpenChange}>
                    <PopoverAnchor asChild>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size={controlSize}>
                                <ClockCounterClockwise data-icon="inline-start" />
                                {rangeLabel}
                            </Button>
                        </DropdownMenuTrigger>
                    </PopoverAnchor>
                    <DropdownMenuContent
                        align="start"
                        className="w-[230px]"
                        // Focus going back to the trigger would dismiss the calendar, so it opens after.
                        onCloseAutoFocus={(event) => {
                            if (!openingCustom.current) return
                            event.preventDefault()
                            openingCustom.current = false
                            setCustomOpen(true)
                        }}
                    >
                        {ANALYTICS_RANGES.map((option) => {
                            const locked = isRangeLocked(option, retention)
                            return (
                                <DropdownMenuItem
                                    key={option.key}
                                    disabled={locked}
                                    onSelect={() => {
                                        onCustomChange(null)
                                        onRangeChange(option.key)
                                    }}
                                    className="justify-between"
                                >
                                    {RANGE_LABEL_KEYS[option.key]
                                        ? t(RANGE_LABEL_KEYS[option.key])
                                        : option.label}
                                    {locked ? (
                                        <LockSimple className="text-muted-foreground" />
                                    ) : option.key === range && !custom ? (
                                        <Check />
                                    ) : null}
                                </DropdownMenuItem>
                            )
                        })}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onSelect={() => {
                                openingCustom.current = true
                            }}
                            className="justify-between"
                        >
                            {t("observabilityUi.analytics.customRange")}
                            {custom ? <Check /> : null}
                        </DropdownMenuItem>
                        {retention && ANALYTICS_RANGES.some((o) => isRangeLocked(o, retention)) ? (
                            <>
                                <DropdownMenuSeparator />
                                <div className="flex flex-col gap-2 px-2 py-1.5">
                                    <span className="text-xs text-muted-foreground">
                                        {t("observabilityUi.analytics.planKeeps", {
                                            plan: retention.planName,
                                            days: retention.days,
                                        })}
                                    </span>
                                    {onUpgrade ? (
                                        <Button
                                            size="xs"
                                            className="self-start"
                                            onClick={onUpgrade}
                                        >
                                            {t("observabilityUi.analytics.upgradePlan")}
                                        </Button>
                                    ) : null}
                                </div>
                            </>
                        ) : null}
                    </DropdownMenuContent>
                </DropdownMenu>
                <PopoverContent align="start" className="w-auto p-0">
                    {customOpen ? (
                        <CustomRangePanel
                            value={custom}
                            retention={retention}
                            onApply={(next) => {
                                onCustomChange(next)
                                setCustomOpen(false)
                            }}
                            onCancel={() => setCustomOpen(false)}
                        />
                    ) : null}
                </PopoverContent>
            </Popover>

            <AnalyticsFilterMenu
                filters={filters}
                onChange={onFiltersChange}
                window={window}
                label={label}
                queryFilters={queryFilters}
                dims={dims}
                locked={locked}
                size={controlSize}
            />

            <GroupMenu
                options={groupOptions}
                value={group}
                onChange={onGroupChange}
                label={
                    group === "none"
                        ? t("observabilityUi.analytics.group")
                        : t("observabilityUi.analytics.groupWith", {group: t(GROUP_LABEL[group])})
                }
                icon={<ListBullets size={ICON} />}
                size={controlSize}
            />

            {locked ? lockedAgentChip : null}

            {active.map((dim) => {
                const values = filters[dim.key].map((key) => label(dim.key, key))
                return (
                    <span
                        key={dim.key}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md bg-muted pl-2.5 pr-1 text-xs"
                    >
                        <span className="text-muted-foreground">{t(dim.label)}</span>
                        <span className="max-w-[220px] truncate">
                            {values.length > 2
                                ? `${values.slice(0, 2).join(", ")} +${values.length - 2}`
                                : values.join(", ")}
                        </span>
                        <button
                            type="button"
                            aria-label={t("observabilityUi.analytics.removeDimFilter", {
                                dim: t(dim.label),
                            })}
                            onClick={() => onFiltersChange({...filters, [dim.key]: []})}
                            className="relative grid size-5 cursor-pointer place-items-center rounded border-0 bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground max-md:after:absolute max-md:after:-inset-3 max-md:after:content-['']"
                        >
                            <X size={12} />
                        </button>
                    </span>
                )
            })}
        </div>
    )
}

const DAY = 24 * 60 * 60 * 1000

// DateRangeCalendar speaks UTC ISO without a zone designator.
const toWire = (ms: number) => new Date(ms).toISOString().slice(0, 19)
const localMidnight = (wire: string) => new Date(new Date(`${wire}Z`).setHours(0, 0, 0, 0))

/** Two months of days to pick a span from, bounded by today and the plan's retention. */
const CustomRangePanel = ({
    value,
    retention,
    onApply,
    onCancel,
}: {
    value: AnalyticsCustomRange | null
    retention: AnalyticsRetention | null
    onApply: (range: AnalyticsCustomRange) => void
    onCancel: () => void
}) => {
    const t = useT(analyticsCatalog)
    const [draft, setDraft] = useState<DateRangeValue>(
        value ? {startTime: toWire(value.oldest), endTime: toWire(value.newest - 1000)} : {},
    )
    const today = new Date(new Date().setHours(0, 0, 0, 0)).getTime()
    const apply = () => {
        if (!draft.startTime || !draft.endTime) return
        const last = localMidnight(draft.endTime)
        onApply({
            oldest: localMidnight(draft.startTime).getTime(),
            newest: new Date(last.setDate(last.getDate() + 1)).getTime(),
        })
    }
    return (
        <div className="flex flex-col">
            <DateRangeCalendar
                value={draft}
                onChange={setDraft}
                showTime={false}
                months={2}
                hideClear
                minDate={retention ? toWire(today - (retention.days - 1) * DAY) : undefined}
                maxDate={toWire(today + DAY - 1000)}
            />
            <div className="flex justify-end gap-2 border-0 border-t border-solid border-border px-3 py-2">
                <Button variant="ghost" size="sm" onClick={onCancel}>
                    {t("observabilityUi.analytics.cancel")}
                </Button>
                <Button size="sm" disabled={!draft.startTime || !draft.endTime} onClick={apply}>
                    {t("observabilityUi.analytics.apply")}
                </Button>
            </div>
        </div>
    )
}

/**
 * Counts per value, ignoring the dimension's own filter so every option stays pickable. A
 * dimension the menu does not offer asks for nothing.
 */
const useFilterCounts = (
    dim: FilterDim,
    filters: AnalyticsFilters,
    window: AnalyticsWindow,
    offered = true,
) => {
    const others = useMemo(() => ({...filters, [dim]: []}), [dim, filters])
    const query = useAnalyticsBuckets(
        dim === "agent" ? "agents" : "models",
        window,
        others,
        null,
        offered,
    )
    return useMemo(() => {
        const paths = dim === "agent" ? [PATH.agentApp, PATH.agentWorkflow] : [PATH.model]
        const series = keyedSeries(window, query.data ?? [], paths)
        const counts: Record<string, number> = {}
        for (const key of rankKeys(series)) counts[key] = sum(series[key])
        for (const key of filters[dim]) counts[key] ??= 0
        return {counts, pending: query.isPending && query.fetchStatus !== "idle"}
    }, [dim, query.data, query.isPending, query.fetchStatus, window, filters])
}

/** Models grouped by provider (largest first), each with its provider's mark. */
const modelOptions = (
    counts: Record<string, number>,
    providerOf: Record<string, string> | null,
    otherLabel: string,
): FilterMenuOption[] => {
    if (!providerOf)
        return Object.keys(counts).map((key) => ({
            value: key,
            label: key,
            icon: <Sparkle size={ICON} />,
        }))
    const totals: Record<string, number> = {}
    for (const [model, count] of Object.entries(counts)) {
        const provider = providerOf[model] ?? ""
        totals[provider] = (totals[provider] ?? 0) + count
    }
    // "" (no provider recorded) always sorts last.
    const rank = (provider: string) => (provider ? totals[provider] : -1)
    return Object.keys(counts)
        .map((model) => ({model, provider: providerOf[model] ?? ""}))
        .sort(
            (a, b) =>
                rank(b.provider) - rank(a.provider) ||
                a.provider.localeCompare(b.provider) ||
                counts[b.model] - counts[a.model],
        )
        .map(({model, provider}) => {
            const ProviderIcon = provider ? getProviderIcon(provider) : null
            return {
                value: model,
                // The heading already names the provider.
                label:
                    provider && model.startsWith(`${provider}/`)
                        ? model.slice(provider.length + 1)
                        : model,
                group: provider ? getProviderDisplayName(provider) : otherLabel,
                icon: ProviderIcon ? (
                    <ProviderIcon className="size-3.5" />
                ) : (
                    <Sparkle size={ICON} />
                ),
            }
        })
}

const useModelProviders = (
    window: AnalyticsWindow,
    filters: AnalyticsFilters,
    enabled: boolean,
) => {
    const others = useMemo(() => ({...filters, model: []}), [filters])
    return (
        useAtomValue(analyticsModelProvidersAtomFamily({window, filters: others, enabled})).data ??
        null
    )
}

const GROUP_LABEL = {
    none: "observabilityUi.analytics.groupNone",
    agent: "observabilityUi.analytics.dimAgent",
    model: "observabilityUi.analytics.dimModel",
    provider: "observabilityUi.analytics.dimProvider",
} as const satisfies Record<AnalyticsGroup, string>

const GROUP_ICONS: Record<AnalyticsGroup, ReactNode> = {
    none: <Minus size={ICON} />,
    agent: <Robot size={ICON} />,
    model: <Sparkle size={ICON} />,
    provider: <Cloud size={ICON} />,
}

const AnalyticsFilterMenu = ({
    filters,
    onChange,
    window,
    label,
    queryFilters,
    dims,
    locked,
    size,
}: {
    filters: AnalyticsFilters
    onChange: (filters: AnalyticsFilters) => void
    window: AnalyticsWindow
    label: (dim: FilterDim, key: string) => string
    /** Counts read these, so the page of one agent counts only its runs. */
    queryFilters: AnalyticsFilters
    /** The dimensions the menu offers. */
    dims: readonly (typeof DIMS)[number][]
    /** The page is locked to one agent: the list is narrowed, so the Filter dot shows (A09). */
    locked: boolean
    size: "compact" | "sm"
}) => {
    const t = useT(analyticsCatalog)
    const [open, setOpen] = useState(false)
    const offersAgent = dims.some((d) => d.key === "agent")
    const agents = useFilterCounts("agent", queryFilters, window, offersAgent)
    const models = useFilterCounts("model", queryFilters, window)
    const providerOf = useModelProviders(window, queryFilters, open)
    const optionAgentName = useAgentNames(Object.keys(agents.counts))
    const anyActive = dims.some((d) => filters[d.key].length)

    const sections = useMemo<FilterMenuSection[]>(
        () =>
            dims.map((d) => {
                const {counts, pending} = d.key === "agent" ? agents : models
                const name = (key: string) =>
                    d.key === "agent" ? optionAgentName(key) : label(d.key, key)
                const selected = filters[d.key]
                const Icon = d.icon
                return {
                    key: d.key,
                    label: t(d.label),
                    icon: <Icon size={ICON} />,
                    multi: true,
                    wide: true,
                    searchable: true,
                    searchPlaceholder: t(d.search),
                    value: selected,
                    valueLabel: !selected.length
                        ? t(d.all)
                        : selected.length === 1
                          ? name(selected[0])
                          : t("observabilityUi.analytics.nSelected", {count: selected.length}),
                    options:
                        d.key === "model"
                            ? modelOptions(
                                  counts,
                                  providerOf,
                                  t("observabilityUi.analytics.otherGroup"),
                              )
                            : Object.keys(counts).map((key) => ({
                                  value: key,
                                  label: name(key),
                                  icon: <Icon size={ICON} />,
                              })),
                    emptyText: pending ? t("observabilityUi.analytics.loading") : t(d.none),
                    onChange: (key: string) =>
                        onChange({
                            ...filters,
                            [d.key]: selected.includes(key)
                                ? selected.filter((k) => k !== key)
                                : [...selected, key],
                        }),
                }
            }),
        [agents, models, providerOf, optionAgentName, label, filters, onChange, dims, t],
    )

    return (
        <FilterMenu
            open={open}
            onOpenChange={setOpen}
            sections={sections}
            searchPlaceholder={t("observabilityUi.analytics.searchAgentsAndModels")}
            align="start"
            active={anyActive || locked}
            size={size}
            onReset={() => onChange({agent: [], model: []})}
            resetDisabled={!anyActive}
        />
    )
}
