import {useMemo, useRef, useState} from "react"

import {
    PATH,
    ANALYTICS_RANGES,
    isRangeLocked,
    keyedSeries,
    rankKeys,
    sum,
    analyticsModelProvidersAtomFamily,
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
    CalendarBlank,
    Check,
    LockSimple,
    Minus,
    Robot,
    Rows,
    Sparkle,
    X,
} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {useAgentNames, useAnalyticsBuckets} from "./useAnalyticsData"

type FilterDim = keyof AnalyticsFilters

const ICON = 14

const DIMS: {key: FilterDim; label: string; plural: string; icon: typeof Robot}[] = [
    {key: "agent", label: "Agent", plural: "agents", icon: Robot},
    {key: "model", label: "Model", plural: "models", icon: Sparkle},
]

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
}: AnalyticsToolbarProps) => {
    const active = DIMS.filter((d) => filters[d.key].length)
    const label = (dim: FilterDim, key: string) => (dim === "agent" ? agentName(key) : key)
    const [customOpen, setCustomOpen] = useState(false)
    const openingCustom = useRef(false)

    return (
        <div className="flex flex-wrap items-center gap-2">
            <Popover open={customOpen} onOpenChange={setCustomOpen}>
                <DropdownMenu open={rangeOpen} onOpenChange={onRangeOpenChange}>
                    <PopoverAnchor asChild>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                                <CalendarBlank data-icon="inline-start" />
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
                                    {option.label}
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
                            Custom range…
                            {custom ? <Check /> : null}
                        </DropdownMenuItem>
                        {retention && ANALYTICS_RANGES.some((o) => isRangeLocked(o, retention)) ? (
                            <>
                                <DropdownMenuSeparator />
                                <div className="flex flex-col gap-2 px-2 py-1.5">
                                    <span className="text-xs text-muted-foreground">
                                        Your {retention.planName} plan keeps {retention.days} days
                                        of history.
                                    </span>
                                    {onUpgrade ? (
                                        <Button
                                            size="xs"
                                            className="self-start"
                                            onClick={onUpgrade}
                                        >
                                            Upgrade plan
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
            />

            <GroupMenu
                options={GROUP_OPTIONS}
                value={group}
                onChange={onGroupChange}
                label={group === "none" ? "Group" : `Group: ${GROUP_LABEL[group]}`}
                icon={<Rows size={ICON} />}
            />

            {active.map((dim) => {
                const values = filters[dim.key].map((key) => label(dim.key, key))
                return (
                    <span
                        key={dim.key}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md bg-muted pl-2.5 pr-1 text-xs"
                    >
                        <span className="text-muted-foreground">{dim.label}</span>
                        <span className="max-w-[220px] truncate">
                            {values.length > 2
                                ? `${values.slice(0, 2).join(", ")} +${values.length - 2}`
                                : values.join(", ")}
                        </span>
                        <button
                            type="button"
                            aria-label={`Remove ${dim.label} filter`}
                            onClick={() => onFiltersChange({...filters, [dim.key]: []})}
                            className="grid size-5 cursor-pointer place-items-center rounded border-0 bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
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
                    Cancel
                </Button>
                <Button size="sm" disabled={!draft.startTime || !draft.endTime} onClick={apply}>
                    Apply
                </Button>
            </div>
        </div>
    )
}

/** Counts per value, ignoring the dimension's own filter so every option stays pickable. */
const useFilterCounts = (dim: FilterDim, filters: AnalyticsFilters, window: AnalyticsWindow) => {
    const others = useMemo(() => ({...filters, [dim]: []}), [dim, filters])
    const query = useAnalyticsBuckets(dim === "agent" ? "agents" : "models", window, others)
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
                group: provider ? getProviderDisplayName(provider) : "Other",
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

const GROUP_LABEL: Record<AnalyticsGroup, string> = {none: "None", agent: "Agent", model: "Model"}

const GROUP_OPTIONS: FilterMenuOption<AnalyticsGroup>[] = [
    {value: "none", label: "None", icon: <Minus size={ICON} />},
    {value: "agent", label: "Agent", icon: <Robot size={ICON} />},
    {value: "model", label: "Model", icon: <Sparkle size={ICON} />},
]

const AnalyticsFilterMenu = ({
    filters,
    onChange,
    window,
    label,
}: {
    filters: AnalyticsFilters
    onChange: (filters: AnalyticsFilters) => void
    window: AnalyticsWindow
    label: (dim: FilterDim, key: string) => string
}) => {
    const [open, setOpen] = useState(false)
    const agents = useFilterCounts("agent", filters, window)
    const models = useFilterCounts("model", filters, window)
    const providerOf = useModelProviders(window, filters, open)
    const optionAgentName = useAgentNames(Object.keys(agents.counts))
    const anyActive = DIMS.some((d) => filters[d.key].length)

    const sections = useMemo<FilterMenuSection[]>(
        () =>
            DIMS.map((d) => {
                const {counts, pending} = d.key === "agent" ? agents : models
                const name = (key: string) =>
                    d.key === "agent" ? optionAgentName(key) : label(d.key, key)
                const selected = filters[d.key]
                const Icon = d.icon
                return {
                    key: d.key,
                    label: d.label,
                    icon: <Icon size={ICON} />,
                    multi: true,
                    wide: true,
                    searchable: true,
                    searchPlaceholder: `Search ${d.plural}…`,
                    value: selected,
                    valueLabel: !selected.length
                        ? `All ${d.plural}`
                        : selected.length === 1
                          ? name(selected[0])
                          : `${selected.length} selected`,
                    options:
                        d.key === "model"
                            ? modelOptions(counts, providerOf)
                            : Object.keys(counts).map((key) => ({
                                  value: key,
                                  label: name(key),
                                  icon: <Icon size={ICON} />,
                              })),
                    emptyText: pending ? "Loading…" : `No ${d.plural} in this range`,
                    onChange: (key: string) =>
                        onChange({
                            ...filters,
                            [d.key]: selected.includes(key)
                                ? selected.filter((k) => k !== key)
                                : [...selected, key],
                        }),
                }
            }),
        [agents, models, providerOf, optionAgentName, label, filters, onChange],
    )

    return (
        <FilterMenu
            open={open}
            onOpenChange={setOpen}
            sections={sections}
            searchPlaceholder="Search agents and models…"
            align="start"
            active={anyActive}
            onReset={() => onChange({agent: [], model: []})}
            resetDisabled={!anyActive}
        />
    )
}
