import type {CSSProperties, ReactNode} from "react"
import {createContext, useContext, useMemo} from "react"

import {useT} from "@agenta/i18n"
import scenariosCatalog from "@agenta/i18n/catalogs/evaluations.scenarios"
import {ValueCell} from "@agenta/ui/cell-renderers"
import {VirtualTable, type ColumnDefs, type VirtualTableProps} from "@agenta/ui/table"
import clsx from "clsx"

import {CompareRowRun} from "../compare/scenarios/CompareRowRun"

import {ScenarioAnnotateButton} from "./ScenarioAnnotateButton"
import {ScenarioColumnMenu} from "./ScenarioColumnMenu"
import type {ScenarioRow} from "./scenarioColumns"
import {ScenarioStatusDot} from "./ScenarioStatusDot"
import {ScenarioTableCell} from "./ScenarioTableCell"
import {
    cellOf,
    type ScenarioColumn,
    type ScenarioEntry,
    type ScenarioEvaluatorColumn,
    type ScenarioEvaluatorGroup,
    type ScenarioFieldColumn,
    type ScenarioMetricColumn,
    type SortDirection,
} from "./scenarioTableColumns"
import {defaultColumnWidth, LEAD_WIDTH, ROW_HEIGHT, type ScenarioView} from "./scenarioViewDefaults"

/** The table's width change, as `VirtualTable` reports a drag. */
export type ScenarioWidthsChange = NonNullable<VirtualTableProps<object>["onColumnSizingChange"]>

export interface ScenarioSort {
    key: string
    direction: SortDirection
}

/** Cells draw their own padding, so a row is exactly its height. */
const NO_PADDING: CSSProperties = {padding: 0}
/** Header cells sit on the page, with no tint. */
const HEADER_STYLE: CSSProperties = {padding: 0, backgroundImage: "none", verticalAlign: "bottom"}
/** A hovered row: the hover fill over the opaque ground, so pinned cells stay opaque. */
const ROW_HOVER = "group-hover/row:bg-[image:linear-gradient(var(--accent),var(--accent))]"
const DIVIDER = "border-0 border-solid border-border-muted"

/**
 * What changes while the table is open (widths, sort), read by the headers, and the actions, read
 * by the headers and cells. Both are kept out of the column list: `VirtualTable` mounts every
 * header again when the list changes, which would close an open column menu on a drag, a width
 * step or a polling tick. They are two contexts, so a drag renders the headers, not the cells.
 */
interface ScenarioHeaderState {
    widths: Record<string, number>
    sort: ScenarioSort | null
}

interface ScenarioTableActions {
    onSort: (sort: ScenarioSort) => void
    onWidth: (key: string, width: number | null) => void
    onHide: (key: string) => void
    onAnnotate: (row: ScenarioRow) => void
    onRetry: () => void
}

const HeaderStateContext = createContext<ScenarioHeaderState>({widths: {}, sort: null})
const ActionsContext = createContext<ScenarioTableActions | null>(null)

const useActions = () => {
    const actions = useContext(ActionsContext)
    if (!actions) throw new Error("ScenarioTable parts render inside ScenarioTable")
    return actions
}

/** A column header with its menu; its width before a drag is `defaultWidth`. */
const ColumnHeader = ({
    columnKey,
    label,
    title,
    defaultWidth,
    right = false,
    narrow = false,
}: {
    columnKey: string
    label: string
    title: string
    defaultWidth: number
    right?: boolean
    narrow?: boolean
}) => {
    const {widths, sort} = useContext(HeaderStateContext)
    const {onSort, onWidth, onHide} = useActions()
    return (
        <ScenarioColumnMenu
            label={label}
            title={title}
            align={right ? "right" : "left"}
            narrow={narrow}
            width={widths[columnKey] ?? defaultWidth}
            sorted={sort?.key === columnKey ? sort.direction : null}
            onSort={(direction) => onSort({key: columnKey, direction})}
            onWidth={(width) => onWidth(columnKey, width)}
            onResetWidth={() => onWidth(columnKey, null)}
            onHide={() => onHide(columnKey)}
        />
    )
}

/**
 * A value cell. A row whose values did not load says so once: in its first visible column read
 * from the trace that has no step error of its own (that cell shows its error).
 */
const ValueTableCell = ({
    traceColumns,
    ...props
}: {
    row: ScenarioRow
    column: ScenarioColumn
    density: ScenarioView["density"]
    lines: 1 | 3
    traceColumns: readonly (ScenarioFieldColumn | ScenarioEvaluatorColumn)[]
}) => {
    const {onRetry} = useActions()
    const {row, column} = props
    const retry =
        row.valuesFailed &&
        traceColumns.find((candidate) => !row.errors[candidate.groupKey])?.key === column.key
    return <ScenarioTableCell {...props} onRetry={retry ? onRetry : undefined} />
}

const AnnotateCell = ({row}: {row: ScenarioRow}) => {
    const {onAnnotate} = useActions()
    return <ScenarioAnnotateButton onClick={() => onAnnotate(row)} />
}

/** Why a compared run shows no scenario on this row. */
const CompareNote = ({entry}: {entry: ScenarioEntry}) => {
    const t = useT(scenariosCatalog)
    return (
        <span className="truncate text-meta text-muted-foreground">
            {entry.failed
                ? t("evaluations.scenarios.compareLoadFailed")
                : entry.pending
                  ? t("evaluations.scenarios.loading")
                  : t("evaluations.scenarios.compareNoMatch")}
        </span>
    )
}

/**
 * The Scenarios table on a window 1,024 px and wider, on `VirtualTable`: the number, the status
 * and the label column stay while the table scrolls sideways; each evaluator's name stands over
 * its metric columns; a header opens its column menu and its edge drags to resize. Clicking a row
 * opens the scenario in the drawer. With `height` the body scrolls on its own under the header.
 */
export const ScenarioTable = ({
    entries,
    label,
    fields,
    evaluators,
    metrics,
    view,
    comparing,
    isHumanRun,
    sort,
    fieldLabel,
    emptyText,
    loading,
    height,
    onSort,
    onWidth,
    onWidths,
    onHide,
    onOpen,
    onAnnotate,
    onRetry,
    onLoadMore,
}: {
    entries: ScenarioEntry[]
    label: ScenarioFieldColumn | null
    fields: ScenarioFieldColumn[]
    evaluators: ScenarioEvaluatorGroup[]
    metrics: ScenarioMetricColumn[]
    view: ScenarioView
    comparing: boolean
    isHumanRun: boolean
    sort: ScenarioSort | null
    fieldLabel: (column: ScenarioFieldColumn) => string
    emptyText: ReactNode
    loading: boolean
    /** The body's height; without it the table is as tall as its rows. */
    height?: number
    onSort: (sort: ScenarioSort) => void
    onWidth: (key: string, width: number | null) => void
    onWidths: ScenarioWidthsChange
    onHide: (key: string) => void
    onOpen: (entry: ScenarioEntry) => void
    onAnnotate: (row: ScenarioRow) => void
    onRetry: () => void
    /** Loads the next page when the body scrolls near its end; absent when none is left. */
    onLoadMore?: () => void
}) => {
    const t = useT(scenariosCatalog)
    const {density, rowHeight, widths} = view
    const compact = density === "compact"
    const tall = rowHeight === "tall"
    const lines = tall ? 3 : 1
    const showWords = entries.some(
        (entry) => entry.row && entry.row.scenario.status?.toLowerCase() !== "success",
    )
    // The visible columns read from the trace, in their order: a row's values error goes to one.
    const traceColumns = useMemo(
        () => [
            ...fields.filter((column) => column.section === "output"),
            ...evaluators.flatMap((group) => group.columns),
        ],
        [fields, evaluators],
    )

    const headerState = useMemo<ScenarioHeaderState>(() => ({widths, sort}), [widths, sort])
    const actions = useMemo<ScenarioTableActions>(
        () => ({onSort, onWidth, onHide, onAnnotate, onRetry}),
        [onSort, onWidth, onHide, onAnnotate, onRetry],
    )

    const columns = useMemo<ColumnDefs<ScenarioEntry>>(() => {
        const cellBox = (narrow: boolean) =>
            clsx(
                "flex min-w-0 overflow-hidden",
                tall ? "h-18 items-start py-2.5" : "h-9 items-center",
                narrow ? "px-1" : "px-2",
            )
        // The last pinned column draws the line between the pinned and the scrolling columns.
        const lastLead = label ? label.key : isHumanRun ? "annotate" : comparing ? "run" : "status"
        const lead = (key: string, width: number, title: ReactNode) => {
            const last = key === lastLead
            return {
                key,
                width,
                fixed: "left" as const,
                title,
                onHeaderCell: () => ({
                    style: HEADER_STYLE,
                    className: clsx(last && `${DIVIDER} border-r`),
                }),
                onCell: () => ({
                    style: NO_PADDING,
                    className: clsx(ROW_HOVER, last && `${DIVIDER} border-r`),
                }),
            }
        }
        const leadTitle = (text: string) => (
            <span className="flex h-7 items-center px-2 text-meta font-normal text-muted-foreground">
                {text}
            </span>
        )
        const valueColumn = (
            column: ScenarioColumn,
            width: number,
            title: ReactNode,
            options: {narrow?: boolean; first?: boolean; fixed?: boolean; last?: boolean} = {},
        ) => ({
            key: column.key,
            width,
            minWidth: 32,
            ...(options.fixed ? {fixed: "left" as const} : {}),
            title,
            onHeaderCell: () => ({
                style: HEADER_STYLE,
                className: clsx(
                    options.first && `${DIVIDER} border-l`,
                    options.last && `${DIVIDER} border-r`,
                ),
            }),
            onCell: () => ({
                style: NO_PADDING,
                className: clsx(ROW_HOVER, options.last && `${DIVIDER} border-r`),
            }),
            render: (_: unknown, entry: ScenarioEntry) => (
                <div className={cellBox(Boolean(options.narrow))}>
                    {entry.row ? (
                        <ValueTableCell
                            row={entry.row}
                            column={column}
                            density={density}
                            lines={lines}
                            traceColumns={traceColumns}
                        />
                    ) : null}
                </div>
            ),
        })

        const defs: ColumnDefs<ScenarioEntry> = [
            {
                ...lead("index", LEAD_WIDTH.index, leadTitle("#")),
                render: (_: unknown, entry: ScenarioEntry) => (
                    <div className={clsx(cellBox(false), "tabular-nums text-muted-foreground")}>
                        {entry.base.index}
                    </div>
                ),
            },
            {
                ...lead(
                    "status",
                    showWords ? LEAD_WIDTH.statusWithWord : LEAD_WIDTH.status,
                    leadTitle(showWords ? t("evaluations.scenarios.status") : ""),
                ),
                render: (_: unknown, entry: ScenarioEntry) => (
                    <div className={cellBox(false)}>
                        {entry.row ? (
                            <ScenarioStatusDot
                                status={entry.row.scenario.status ?? null}
                                title={entry.row.otherErrors.join("; ") || undefined}
                            />
                        ) : null}
                    </div>
                ),
            },
        ]
        if (comparing) {
            defs.push({
                ...lead("run", LEAD_WIDTH.run, leadTitle(t("evaluations.scenarios.evaluation"))),
                render: (_: unknown, entry: ScenarioEntry) => (
                    <div className={clsx(cellBox(false), "gap-2")}>
                        <CompareRowRun slot={entry.slot} name={entry.runName} />
                        {/* With no label column, the run column says why a row is empty. */}
                        {!label && !entry.row ? <CompareNote entry={entry} /> : null}
                    </div>
                ),
            })
        }
        if (isHumanRun) {
            defs.push({
                ...lead("annotate", LEAD_WIDTH.annotate, null),
                render: (_: unknown, entry: ScenarioEntry) => (
                    <div className={cellBox(false)}>
                        {entry.slot === 0 && entry.row ? <AnnotateCell row={entry.row} /> : null}
                    </div>
                ),
            })
        }
        if (label) {
            const name = fieldLabel(label)
            const width = LEAD_WIDTH.label[density]
            defs.push({
                ...valueColumn(
                    label,
                    width,
                    <ColumnHeader
                        columnKey={label.key}
                        label={name}
                        title={name}
                        defaultWidth={width}
                    />,
                    {fixed: true, last: true},
                ),
                render: (_: unknown, entry: ScenarioEntry) => (
                    <div className={cellBox(false)}>
                        {entry.row ? (
                            <ValueCell
                                value={cellOf(entry.row, label)?.value}
                                density={density}
                                lines={lines}
                            />
                        ) : (
                            <CompareNote entry={entry} />
                        )}
                    </div>
                ),
            })
        }
        for (const column of fields) {
            const name = fieldLabel(column)
            const width = defaultColumnWidth(column, density)
            defs.push(
                valueColumn(
                    column,
                    width,
                    <ColumnHeader
                        columnKey={column.key}
                        label={name}
                        title={name}
                        defaultWidth={width}
                    />,
                ),
            )
        }
        for (const group of evaluators) {
            defs.push({
                key: `group::${group.key}`,
                title: (
                    <div
                        title={group.label}
                        className={clsx(
                            "flex overflow-hidden px-2 font-medium text-foreground",
                            compact
                                ? "h-14 items-end pb-0.5 text-meta"
                                : "h-10 items-center text-label",
                        )}
                    >
                        <span className={compact ? "line-clamp-3" : "line-clamp-2"}>
                            {group.label}
                        </span>
                    </div>
                ),
                onHeaderCell: () => ({style: HEADER_STYLE, className: `${DIVIDER} border-l`}),
                children: group.columns.map((column, position) => {
                    const width = defaultColumnWidth(column, density)
                    return valueColumn(
                        column,
                        width,
                        <ColumnHeader
                            columnKey={column.key}
                            label={column.label}
                            title={`${group.label} · ${column.label}`}
                            defaultWidth={width}
                            right={column.metricKind === "numeric"}
                            narrow={compact}
                        />,
                        {narrow: compact, first: position === 0},
                    )
                }),
            })
        }
        for (const column of metrics) {
            const width = defaultColumnWidth(column, density)
            defs.push(
                valueColumn(
                    column,
                    width,
                    <ColumnHeader
                        columnKey={column.key}
                        label={column.label}
                        title={column.label}
                        defaultWidth={width}
                        right
                    />,
                ),
            )
        }
        return defs
    }, [
        comparing,
        compact,
        density,
        evaluators,
        fieldLabel,
        fields,
        isHumanRun,
        label,
        lines,
        metrics,
        traceColumns,
        showWords,
        t,
        tall,
    ])

    return (
        <ActionsContext.Provider value={actions}>
            <HeaderStateContext.Provider value={headerState}>
                <VirtualTable<ScenarioEntry>
                    height={height}
                    loadMore={onLoadMore}
                    columns={columns}
                    dataSource={entries}
                    rowKey={(entry) => entry.key}
                    rowHeight={ROW_HEIGHT[rowHeight] + 1}
                    enableColumnResizing
                    columnSizing={widths}
                    onColumnSizingChange={onWidths}
                    loading={loading}
                    emptyText={emptyText}
                    onRow={(entry) =>
                        entry.row
                            ? {
                                  tabIndex: 0,
                                  className: "group/row cursor-pointer",
                                  onClick: () => onOpen(entry),
                                  onKeyDown: (event) => {
                                      // Enter on a control in the row (Annotate, Try again, a link) is
                                      // that control's own.
                                      if (
                                          event.key === "Enter" &&
                                          event.target === event.currentTarget
                                      )
                                          onOpen(entry)
                                  },
                              }
                            : {className: "group/row"}
                    }
                />
            </HeaderStateContext.Provider>
        </ActionsContext.Provider>
    )
}
