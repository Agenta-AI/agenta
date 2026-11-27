import {useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import scenariosCatalog from "@agenta/i18n/catalogs/evaluations.scenarios"
import {
    Button,
    DropdownMenuCheckboxItem,
    DropdownMenuItem,
    DropdownMenuSeparator,
    Input,
} from "@agenta/ui/ui"
import {DotsSixVertical, MagnifyingGlass} from "@phosphor-icons/react"

import type {
    ScenarioEvaluatorGroup,
    ScenarioFieldColumn,
    ScenarioMetricColumn,
} from "./scenarioTableColumns"

interface PanelRow {
    key: string
    label: string
    /** Keys this row hides. */
    keys: string[]
    /** Keys this row shows when none of its columns shows: an evaluator's reasons stay hidden. */
    showKeys: string[]
    /** A section's rows reorder among themselves; invocation metrics keep their order. */
    section: "testcase" | "output" | "evaluators" | null
    metrics: {key: string; label: string}[]
}

/** An evaluator's metrics to show when it is ticked: its metrics that are not text, else all. */
const evaluatorShowKeys = (group: ScenarioEvaluatorGroup) => {
    const short = group.columns.filter((column) => column.metricKind !== "text")
    return (short.length > 0 ? short : group.columns).map((column) => column.key)
}

/**
 * The Columns part of the Display menu: find a column, drag a test case column, an output or an
 * evaluator to reorder it, tick it to show or hide it, and show or hide one metric of an
 * evaluator with its chip. Changes apply at once.
 */
export const ScenarioColumnsPanel = ({
    fields,
    evaluators,
    metrics,
    hidden,
    labelName,
    fieldLabel,
    orderByFailures,
    totalColumns,
    onHide,
    onMove,
    onOrderByFailures,
    onShowAll,
}: {
    /** Test case and output columns, without the label column, in the shown order. */
    fields: ScenarioFieldColumn[]
    evaluators: ScenarioEvaluatorGroup[]
    metrics: ScenarioMetricColumn[]
    hidden: ReadonlySet<string>
    /** The name of the label column, which the test case section leaves out. */
    labelName: string | null
    fieldLabel: (column: ScenarioFieldColumn) => string
    orderByFailures: boolean
    totalColumns: number
    onHide: (keys: string[], hide: boolean) => void
    onMove: (key: string, before: string) => void
    onOrderByFailures: (on: boolean) => void
    onShowAll: () => void
}) => {
    const t = useT(scenariosCatalog)
    const [query, setQuery] = useState("")
    const [dragged, setDragged] = useState<{key: string; section: PanelRow["section"]} | null>(null)
    const needle = query.trim().toLowerCase()
    const matches = (row: PanelRow) =>
        !needle ||
        [row.label, ...row.metrics.map((metric) => metric.label)].some((text) =>
            text.toLowerCase().includes(needle),
        )

    const fieldRow = (column: ScenarioFieldColumn): PanelRow => ({
        key: column.key,
        label: fieldLabel(column),
        keys: [column.key],
        showKeys: [column.key],
        section: column.section,
        metrics: [],
    })
    const sections: {key: string; title: string; note?: string; rows: PanelRow[]}[] = [
        {
            key: "testcase",
            title: t("evaluations.scenarios.sectionTestCase"),
            note: labelName
                ? t("evaluations.scenarios.isLabelColumn", {column: labelName})
                : undefined,
            rows: fields.filter((column) => column.section === "testcase").map(fieldRow),
        },
        {
            key: "output",
            title: t("evaluations.scenarios.sectionOutput"),
            rows: fields.filter((column) => column.section === "output").map(fieldRow),
        },
        {
            key: "evaluators",
            title: t("evaluations.scenarios.sectionEvaluators"),
            note: t("evaluations.scenarios.evaluatorCount", {count: evaluators.length}),
            rows: evaluators.map((group) => ({
                key: group.key,
                label: group.label,
                keys: group.columns.map((column) => column.key),
                showKeys: evaluatorShowKeys(group),
                section: "evaluators",
                metrics: group.columns.map((column) => ({key: column.key, label: column.label})),
            })),
        },
        {
            key: "metrics",
            title: t("evaluations.scenarios.sectionMetrics"),
            rows: metrics.map((column) => ({
                key: column.key,
                label: column.label,
                keys: [column.key],
                showKeys: [column.key],
                section: null,
                metrics: [],
            })),
        },
    ]

    const renderRow = (row: PanelRow): ReactNode => {
        const shown = row.keys.filter((key) => !hidden.has(key))
        const canDrag = row.section !== null && !needle
        return (
            <div
                key={row.key}
                className="flex items-center gap-1"
                draggable={canDrag}
                onDragStart={() => setDragged({key: row.key, section: row.section})}
                onDragEnd={() => setDragged(null)}
                onDragOver={(event) => {
                    // A row moves only among the rows of its own section.
                    if (dragged && dragged.key !== row.key && dragged.section === row.section)
                        event.preventDefault()
                }}
                onDrop={(event) => {
                    event.preventDefault()
                    if (dragged && dragged.section === row.section) onMove(dragged.key, row.key)
                    setDragged(null)
                }}
            >
                {row.section !== null ? (
                    <span
                        title={t("evaluations.scenarios.dragToReorder")}
                        className="flex shrink-0 cursor-grab text-muted-foreground"
                    >
                        <DotsSixVertical aria-hidden size={12} />
                    </span>
                ) : (
                    <span aria-hidden className="w-3 shrink-0" />
                )}
                <DropdownMenuCheckboxItem
                    className="min-w-0 flex-1"
                    checked={shown.length > 0}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() =>
                        shown.length > 0 ? onHide(row.keys, true) : onHide(row.showKeys, false)
                    }
                >
                    <span className="min-w-0 truncate">{row.label}</span>
                </DropdownMenuCheckboxItem>
                {row.metrics.map((metric) => {
                    const on = !hidden.has(metric.key)
                    return (
                        <Button
                            key={metric.key}
                            size="xs"
                            variant={on ? "secondary" : "ghost"}
                            aria-pressed={on}
                            title={t(
                                on
                                    ? "evaluations.scenarios.hideColumnNamed"
                                    : "evaluations.scenarios.showColumn",
                                {column: `${row.label} · ${metric.label}`},
                            )}
                            className={on ? undefined : "text-muted-foreground"}
                            onClick={() => onHide([metric.key], on)}
                        >
                            {metric.label}
                        </Button>
                    )
                })}
            </div>
        )
    }

    return (
        <div className="flex max-h-150 min-h-0 flex-col">
            <div className="flex items-center gap-2 border-0 border-b border-solid border-border-muted p-1">
                <MagnifyingGlass aria-hidden size={14} className="ml-2 text-muted-foreground" />
                <Input
                    variant="ghost"
                    size="sm"
                    value={query}
                    placeholder={t("evaluations.scenarios.findColumn")}
                    aria-label={t("evaluations.scenarios.findColumn")}
                    // The menu reads typed letters to jump between items; the field keeps them.
                    onKeyDown={(event) => event.stopPropagation()}
                    onChange={(event) => setQuery(event.target.value)}
                />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1">
                {sections.map((section) => {
                    const rows = section.rows.filter(matches)
                    if (rows.length === 0) return null
                    return (
                        <div key={section.key}>
                            <div className="flex h-7 items-center justify-between gap-2 px-2 text-meta text-muted-foreground">
                                <span>{section.title}</span>
                                {section.note ? (
                                    <span className="truncate">{section.note}</span>
                                ) : null}
                            </div>
                            {rows.map(renderRow)}
                        </div>
                    )
                })}
            </div>
            <DropdownMenuSeparator className="mx-0 my-0" />
            <div className="p-1">
                <DropdownMenuCheckboxItem
                    checked={orderByFailures}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) => onOrderByFailures(checked === true)}
                >
                    {t("evaluations.scenarios.orderByFailures")}
                </DropdownMenuCheckboxItem>
                <DropdownMenuItem
                    inset
                    onSelect={(event) => {
                        event.preventDefault()
                        onShowAll()
                    }}
                >
                    <span className="flex-1">{t("evaluations.scenarios.showAllColumns")}</span>
                    <span className="text-muted-foreground">
                        {t("evaluations.scenarios.columnCount", {count: totalColumns})}
                    </span>
                </DropdownMenuItem>
            </div>
        </div>
    )
}
