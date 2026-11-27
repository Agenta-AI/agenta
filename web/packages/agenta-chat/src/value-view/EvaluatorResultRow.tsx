import {useId, useState, type ReactNode} from "react"

import type {EvaluatorResultMetric, EvaluatorResultSummary} from "@agenta/entities/evaluationRun"
import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import {formatShapeNumber} from "@agenta/shared/utils"
import {Badge, Button, CollapseCaret, cn} from "@agenta/ui/ui"

import {ValueField} from "./ValueField"

export interface EvaluatorResultRowProps {
    /** The evaluator's name. */
    name: string
    summary: EvaluatorResultSummary
    /** The message of an errored evaluator, shown on expand. */
    error?: string | null
    /** "Open trace" next to the error; without it the link is not shown. */
    onOpenTrace?: () => void
    /** At the end of the row: the trace button. */
    actions?: ReactNode
    /** On expand, under the metrics: the step's duration, tokens and cost. */
    details?: ReactNode
    defaultOpen?: boolean
}

/** A metric value on the row or in the grid: Pass or Fail, a number, labels. */
const MetricValue = ({metric}: {metric: EvaluatorResultMetric}) => {
    const t = useT(valueViewCatalog)
    const {kind, value} = metric
    if (kind === "binary" && typeof value === "boolean") {
        return (
            <Badge variant={value ? "success" : "destructive"}>
                {t(value ? "chat.valueView.pass" : "chat.valueView.fail")}
            </Badge>
        )
    }
    if (typeof value === "number") {
        return <span className="text-label tabular-nums">{formatShapeNumber(value)}</span>
    }
    if (value === null || value === undefined || value === "") {
        return <span className="text-muted-foreground">—</span>
    }
    const labels = Array.isArray(value) ? value : [value]
    return (
        <span className="inline-flex flex-wrap gap-1">
            {labels.map((label, index) => (
                <Badge key={index} className="text-foreground">
                    {String(label)}
                </Badge>
            ))}
        </span>
    )
}

/** A metric as plain text, the way `MetricValue` draws it: a list joined, no value as a dash. */
const metricText = ({value}: EvaluatorResultMetric): string => {
    if (typeof value === "number") return formatShapeNumber(value)
    if (value === null || value === undefined || value === "") return "—"
    return Array.isArray(value) ? value.map(String).join(", ") : String(value)
}

/** What the collapsed row shows after the name. */
const InlineMetrics = ({summary}: {summary: EvaluatorResultSummary}) => {
    const t = useT(valueViewCatalog)
    const {inline} = summary
    if (summary.state === "pending") {
        return (
            <>
                <span className="text-meta text-muted-foreground">
                    {t("chat.valueView.running")}
                </span>
                <span aria-hidden className="h-2 w-15 rounded-sm bg-selected" />
            </>
        )
    }
    if (summary.state === "error") {
        return <Badge variant="destructive">{t("chat.valueView.error")}</Badge>
    }
    if (summary.state === "notRun") {
        return <span className="text-meta text-muted-foreground">{t("chat.valueView.notRun")}</span>
    }
    if (inline.kind === "metrics") {
        return inline.metrics.map((metric) => (
            <span key={metric.name} className="inline-flex items-center gap-1.5">
                <span className="text-meta text-muted-foreground">{metric.name}</span>
                <MetricValue metric={metric} />
            </span>
        ))
    }
    if (inline.kind === "passed") {
        return (
            <>
                {inline.failedNames.map((name) => (
                    <Badge key={name} variant="destructive">
                        {name}
                    </Badge>
                ))}
                <span
                    className={cn(
                        "text-meta font-medium",
                        inline.failedNames.length > 0
                            ? "text-destructive"
                            : "text-muted-foreground",
                    )}
                >
                    {t("chat.valueView.passedOf", {passed: inline.passed, total: inline.total})}
                </span>
            </>
        )
    }
    return (
        <span className="text-meta text-muted-foreground">
            {inline.metrics.map((metric) => `${metric.name} ${metricText(metric)}`).join(", ")}{" "}
            {t("chat.valueView.moreMetrics", {count: inline.more})}
        </span>
    )
}

/**
 * One evaluator of one test case or span as one row: its name, then its short metrics by their
 * own names, Pass or Fail only for true or false metrics. More than three short metrics read as
 * "X of Y passed" (or the first two and "+N more" with no binary metric) and open to a grid.
 * Reasons and JSON outputs show only on expand. Never red without a false metric or an error.
 */
export const EvaluatorResultRow = ({
    name,
    summary,
    error,
    onOpenTrace,
    actions,
    details,
    defaultOpen = false,
}: EvaluatorResultRowProps) => {
    const t = useT(valueViewCatalog)
    const [open, setOpen] = useState(defaultOpen)
    const regionId = useId()
    // More short metrics than the row shows inline open to a grid.
    const grid = summary.inline.kind !== "metrics"
    const expandable =
        summary.state === "error" ||
        (summary.state === "done" && (grid || summary.text.length > 0 || Boolean(details)))

    const title = <span className="min-w-0 flex-1 truncate text-label">{name}</span>
    return (
        <div className="border-0 border-b border-solid border-border-muted">
            <div className="flex min-h-9 items-center gap-2 py-1">
                {expandable ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        aria-expanded={open}
                        aria-controls={regionId}
                        className="h-auto min-w-0 flex-1 justify-start gap-2 px-0 text-left text-foreground hover:bg-transparent aria-expanded:bg-transparent"
                        onClick={() => setOpen((next) => !next)}
                    >
                        <CollapseCaret open={open} />
                        {title}
                    </Button>
                ) : (
                    <>
                        <span aria-hidden className="w-3 shrink-0" />
                        {title}
                    </>
                )}
                <span className="flex flex-wrap items-center justify-end gap-2">
                    <InlineMetrics summary={summary} />
                </span>
                {actions}
            </div>
            {expandable && open ? (
                <div id={regionId} className="flex flex-col gap-1 pb-2.5 pl-5 text-body-sm">
                    {summary.state === "error" ? (
                        <>
                            <span className="text-meta text-muted-foreground">
                                {t("chat.valueView.errorLabel")}
                            </span>
                            {error ? (
                                <div className="whitespace-pre-wrap break-words font-mono text-code-sm text-destructive">
                                    {error}
                                </div>
                            ) : null}
                            {onOpenTrace ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="xs"
                                    className="self-start"
                                    onClick={onOpenTrace}
                                >
                                    {t("chat.valueView.openTrace")}
                                </Button>
                            ) : null}
                        </>
                    ) : null}
                    {summary.state === "done" && grid ? (
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                            {summary.short.map((metric) => (
                                <div
                                    key={metric.name}
                                    className="flex min-h-7.5 min-w-0 items-center justify-between gap-1.5 rounded-md bg-muted px-2"
                                >
                                    <span className="min-w-0 truncate text-meta text-muted-foreground">
                                        {metric.name}
                                    </span>
                                    <MetricValue metric={metric} />
                                </div>
                            ))}
                        </div>
                    ) : null}
                    {summary.state === "done"
                        ? summary.text.map((metric) => (
                              <div key={metric.name} className="flex min-w-0 flex-col gap-0.5">
                                  <span className="text-meta text-muted-foreground">
                                      {metric.name}
                                  </span>
                                  <ValueField value={metric.value} label={metric.name} />
                              </div>
                          ))
                        : null}
                    {details}
                </div>
            ) : null}
        </div>
    )
}
