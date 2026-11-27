import type {ChartMetric} from "@agenta/entities/evaluationRun"
import {useT} from "@agenta/i18n"
import runOverviewCatalog from "@agenta/i18n/catalogs/evaluations.runOverview"
import {
    Button,
    Checkbox,
    Command,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@agenta/ui/ui"
import {CaretDown} from "@phosphor-icons/react"

import {chartValueText} from "./metricsChartText"

/**
 * The metric picker of the "Metrics" chart: one checkbox row per chartable metric with its value,
 * lowest first. `valueKey` is the run whose value each row shows.
 */
export const MetricPicker = ({
    metrics,
    selected,
    valueKey,
    onToggle,
}: {
    metrics: readonly ChartMetric[]
    selected: ReadonlySet<string>
    valueKey: string
    onToggle: (id: string) => void
}) => {
    const t = useT(runOverviewCatalog)
    const count = metrics.filter((metric) => selected.has(metric.id)).length
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5">
                    {t("evaluations.runOverview.metricsPicked", {
                        selected: count,
                        total: metrics.length,
                    })}
                    <CaretDown size={12} className="text-muted-foreground" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-1">
                <Command>
                    <CommandInput placeholder={t("evaluations.runOverview.searchMetrics")} />
                    <CommandList className="max-h-72">
                        <CommandGroup>
                            {metrics.map((metric) => {
                                const name = `${metric.evaluatorName}: ${metric.label}`
                                const value = metric.values[valueKey]
                                const checked = selected.has(metric.id)
                                return (
                                    <CommandItem
                                        key={metric.id}
                                        value={metric.id}
                                        aria-checked={checked}
                                        keywords={[name]}
                                        onSelect={() => onToggle(metric.id)}
                                    >
                                        <Checkbox
                                            checked={checked}
                                            tabIndex={-1}
                                            aria-hidden
                                            className="pointer-events-none"
                                        />
                                        <span className="min-w-0 flex-1 truncate" title={name}>
                                            {name}
                                        </span>
                                        <span className="text-meta tabular-nums text-muted-foreground">
                                            {value === null || value === undefined
                                                ? ""
                                                : chartValueText(metric.kind, value)}
                                        </span>
                                    </CommandItem>
                                )
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
