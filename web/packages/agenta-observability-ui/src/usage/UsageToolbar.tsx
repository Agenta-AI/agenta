import {useMemo} from "react"

import {
    PATH,
    USAGE_RANGE,
    USAGE_RANGES,
    isRangeLocked,
    keyedSeries,
    rankKeys,
    sum,
    type UsageFilters,
    type UsageRangeKey,
    type UsageRetention,
    type UsageWindow,
} from "@agenta/observability/usage"
import {FilterMenu, type FilterMenuSection} from "@agenta/ui/filter-menu"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {CalendarBlank, CaretDown, Check, LockSimple, Robot, Sparkle, X} from "@phosphor-icons/react"

import {useAgentNames, useUsageBuckets} from "./useUsageData"

type FilterDim = keyof UsageFilters

const ICON = 14

const DIMS: {key: FilterDim; label: string; plural: string; icon: typeof Robot}[] = [
    {key: "agent", label: "Agent", plural: "agents", icon: Robot},
    {key: "model", label: "Model", plural: "models", icon: Sparkle},
]

export interface UsageToolbarProps {
    range: UsageRangeKey
    onRangeChange: (range: UsageRangeKey) => void
    retention: UsageRetention | null
    onUpgrade?: () => void
    filters: UsageFilters
    onFiltersChange: (filters: UsageFilters) => void
    window: UsageWindow
    agentName: (id: string) => string
    rangeOpen: boolean
    onRangeOpenChange: (open: boolean) => void
}

export const UsageToolbar = ({
    range,
    onRangeChange,
    retention,
    onUpgrade,
    filters,
    onFiltersChange,
    window,
    agentName,
    rangeOpen,
    onRangeOpenChange,
}: UsageToolbarProps) => {
    const active = DIMS.filter((d) => filters[d.key].length)
    const label = (dim: FilterDim, key: string) => (dim === "agent" ? agentName(key) : key)

    return (
        <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu open={rangeOpen} onOpenChange={onRangeOpenChange}>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                        <CalendarBlank data-icon="inline-start" />
                        {USAGE_RANGE[range].label}
                        <CaretDown data-icon="inline-end" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[230px]">
                    {USAGE_RANGES.map((option) => {
                        const locked = isRangeLocked(option, retention)
                        return (
                            <DropdownMenuItem
                                key={option.key}
                                disabled={locked}
                                onSelect={() => onRangeChange(option.key)}
                                className="justify-between"
                            >
                                {option.label}
                                {locked ? (
                                    <LockSimple className="text-muted-foreground" />
                                ) : option.key === range ? (
                                    <Check />
                                ) : null}
                            </DropdownMenuItem>
                        )
                    })}
                    {retention && USAGE_RANGES.some((o) => isRangeLocked(o, retention)) ? (
                        <>
                            <DropdownMenuSeparator />
                            <div className="flex flex-col gap-2 px-2 py-1.5">
                                <span className="text-xs text-muted-foreground">
                                    Your {retention.planName} plan keeps {retention.days} days of
                                    history.
                                </span>
                                {onUpgrade ? (
                                    <Button size="xs" className="self-start" onClick={onUpgrade}>
                                        Upgrade plan
                                    </Button>
                                ) : null}
                            </div>
                        </>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>

            <UsageFilterMenu
                filters={filters}
                onChange={onFiltersChange}
                window={window}
                label={label}
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

/** Counts per value, ignoring the dimension's own filter so every option stays pickable. */
const useFilterCounts = (dim: FilterDim, filters: UsageFilters, window: UsageWindow) => {
    const others = useMemo(() => ({...filters, [dim]: []}), [dim, filters])
    const query = useUsageBuckets(dim === "agent" ? "agents" : "models", window, others)
    return useMemo(() => {
        const paths = dim === "agent" ? [PATH.agentApp, PATH.agentWorkflow] : [PATH.model]
        const series = keyedSeries(window, query.data ?? [], paths)
        const counts: Record<string, number> = {}
        for (const key of rankKeys(series)) counts[key] = sum(series[key])
        for (const key of filters[dim]) counts[key] ??= 0
        return {counts, pending: query.isPending && query.fetchStatus !== "idle"}
    }, [dim, query.data, query.isPending, query.fetchStatus, window, filters])
}

const UsageFilterMenu = ({
    filters,
    onChange,
    window,
    label,
}: {
    filters: UsageFilters
    onChange: (filters: UsageFilters) => void
    window: UsageWindow
    label: (dim: FilterDim, key: string) => string
}) => {
    const agents = useFilterCounts("agent", filters, window)
    const models = useFilterCounts("model", filters, window)
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
                    options: Object.keys(counts).map((key) => ({
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
        [agents, models, optionAgentName, label, filters, onChange],
    )

    return (
        <FilterMenu
            sections={sections}
            searchPlaceholder="Search agents and models…"
            align="start"
            active={anyActive}
            onReset={() => onChange({agent: [], model: []})}
            resetDisabled={!anyActive}
        />
    )
}
