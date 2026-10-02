import {useMemo, useState} from "react"

import {
    PATH,
    USAGE_RANGE,
    USAGE_RANGES,
    formatCount,
    isRangeLocked,
    keyedSeries,
    rankKeys,
    sum,
    type UsageFilters,
    type UsageRangeKey,
    type UsageRetention,
    type UsageWindow,
} from "@agenta/observability/usage"
import {
    Button,
    Checkbox,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Popover,
    PopoverContent,
    PopoverTrigger,
    cn,
} from "@agenta/ui/ui"
import {
    ArrowCounterClockwise,
    CalendarBlank,
    CaretDown,
    CaretRight,
    Check,
    FunnelSimple,
    LockSimple,
    MagnifyingGlass,
    Robot,
    Sparkle,
    X,
} from "@phosphor-icons/react"

import {useAgentNames, useUsageBuckets} from "./useUsageData"

type FilterDim = keyof UsageFilters

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

            <FilterPopover
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

const FilterPopover = ({
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
    const [open, setOpen] = useState(false)
    const [dim, setDim] = useState<FilterDim>("agent")
    const [query, setQuery] = useState("")
    const count = DIMS.filter((d) => filters[d.key].length).length

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant={count ? "secondary" : "outline"} size="sm">
                    <FunnelSimple data-icon="inline-start" />
                    Filter
                    {count ? (
                        <span className="grid size-4 place-items-center rounded-full bg-foreground text-[10px] text-background">
                            {count}
                        </span>
                    ) : null}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[520px] max-w-[calc(100vw-32px)] p-0">
                {open ? (
                    <FilterPanel
                        filters={filters}
                        onChange={onChange}
                        window={window}
                        label={label}
                        dim={dim}
                        onDim={setDim}
                        query={query}
                        onQuery={setQuery}
                    />
                ) : null}
            </PopoverContent>
        </Popover>
    )
}

/** Counts per value, ignoring the dimension's own filter so every option stays pickable. */
const useFilterOptions = (dim: FilterDim, filters: UsageFilters, window: UsageWindow) => {
    const others = {...filters, [dim]: []}
    const query = useUsageBuckets(dim === "agent" ? "agents" : "models", window, others)
    return useMemo(() => {
        const paths = dim === "agent" ? [PATH.agentApp, PATH.agentWorkflow] : [PATH.model]
        const series = keyedSeries(window, query.data ?? [], paths)
        const counts: Record<string, number> = {}
        for (const key of rankKeys(series)) counts[key] = sum(series[key])
        for (const key of filters[dim]) counts[key] ??= 0
        return {counts, pending: query.isPending}
    }, [dim, query.data, query.isPending, window, filters])
}

const FilterPanel = ({
    filters,
    onChange,
    window,
    label,
    dim,
    onDim,
    query,
    onQuery,
}: {
    filters: UsageFilters
    onChange: (filters: UsageFilters) => void
    window: UsageWindow
    label: (dim: FilterDim, key: string) => string
    dim: FilterDim
    onDim: (dim: FilterDim) => void
    query: string
    onQuery: (query: string) => void
}) => {
    const options = useFilterOptions(dim, filters, window)
    const optionAgentName = useAgentNames(dim === "agent" ? Object.keys(options.counts) : [])
    const name = (key: string) => (dim === "agent" ? optionAgentName(key) : label(dim, key))
    const toggle = (key: string) => {
        const current = filters[dim]
        onChange({
            ...filters,
            [dim]: current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
        })
    }
    const q = query.trim().toLowerCase()
    const keys = Object.keys(options.counts)
        .filter((key) => !q || name(key).toLowerCase().includes(q))
        .sort((a, b) => options.counts[b] - options.counts[a])
    const anyActive = DIMS.some((d) => filters[d.key].length)

    return (
        <div className="grid grid-cols-[180px_minmax(0,1fr)]">
            <div className="flex flex-col border-0 border-r border-solid border-border p-1">
                {DIMS.map((d) => {
                    const selected = filters[d.key]
                    const Icon = d.icon
                    return (
                        <button
                            key={d.key}
                            type="button"
                            onClick={() => onDim(d.key)}
                            onMouseEnter={() => onDim(d.key)}
                            className={cn(
                                "flex h-9 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-sm",
                                dim === d.key && "bg-accent",
                            )}
                        >
                            <Icon size={14} className="text-muted-foreground" />
                            <span className="flex-1">{d.label}</span>
                            <span
                                className={cn(
                                    "max-w-[80px] truncate text-xs",
                                    selected.length ? "text-foreground" : "text-muted-foreground",
                                )}
                            >
                                {!selected.length
                                    ? `All ${d.plural}`
                                    : selected.length === 1
                                      ? label(d.key, selected[0])
                                      : `${selected.length} selected`}
                            </span>
                            <CaretRight size={12} className="text-muted-foreground" />
                        </button>
                    )
                })}
                <div className="mt-auto border-0 border-t border-solid border-border pt-1">
                    <button
                        type="button"
                        disabled={!anyActive}
                        onClick={() => onChange({agent: [], model: []})}
                        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-sm text-foreground hover:bg-accent disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent"
                    >
                        <ArrowCounterClockwise size={14} />
                        Reset to defaults
                    </button>
                </div>
            </div>
            <div className="flex min-w-0 flex-col">
                <div className="flex h-10 items-center gap-2 border-0 border-b border-solid border-border px-3">
                    <MagnifyingGlass size={14} className="text-muted-foreground" />
                    <input
                        autoFocus
                        value={query}
                        onChange={(event) => onQuery(event.target.value)}
                        placeholder={`Search ${DIMS.find((d) => d.key === dim)?.plural}…`}
                        className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm outline-none"
                    />
                </div>
                <div className="flex max-h-[300px] flex-col overflow-y-auto p-1">
                    {options.pending ? (
                        <span className="px-2 py-2 text-sm text-muted-foreground">Loading…</span>
                    ) : keys.length ? (
                        keys.map((key) => (
                            <label
                                key={key}
                                className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-accent"
                            >
                                <Checkbox
                                    checked={filters[dim].includes(key)}
                                    onCheckedChange={() => toggle(key)}
                                />
                                <span className="min-w-0 flex-1 truncate">{name(key)}</span>
                                <span className="text-xs text-muted-foreground tabular-nums">
                                    {formatCount(options.counts[key])} runs
                                </span>
                            </label>
                        ))
                    ) : (
                        <span className="px-2 py-2 text-sm text-muted-foreground">No matches</span>
                    )}
                </div>
            </div>
        </div>
    )
}
