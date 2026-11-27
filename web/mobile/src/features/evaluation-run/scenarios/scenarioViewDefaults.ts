import type {ValueShape} from "@agenta/shared/utils"

import type {ScenarioColumn, ScenarioColumnModel, ScenarioFieldColumn} from "./scenarioTableColumns"

export type ScenarioDensity = "compact" | "comfortable"
export type ScenarioRowHeight = "short" | "tall"

/**
 * How one user sees the Scenarios table of one run. Hidden columns are kept as changes to the
 * defaults, because the defaults depend on the loaded values (a metric's kind, a value's shape),
 * which arrive after the view is read.
 */
export interface ScenarioView {
    density: ScenarioDensity
    rowHeight: ScenarioRowHeight
    /** The label column's key; null for no label column; absent for the default. */
    label?: string | null
    /** Columns the user hid that show by default. */
    hide: string[]
    /** Columns the user showed that are hidden by default. */
    show: string[]
    /** Keys of test case and output columns and of evaluators, in the user's order. */
    order: string[]
    /** Widths the user set, in px, by column key. */
    widths: Record<string, number>
    orderByFailures: boolean
}

export const DEFAULT_SCENARIO_VIEW: ScenarioView = {
    density: "compact",
    rowHeight: "short",
    hide: [],
    show: [],
    order: [],
    widths: {},
    orderByFailures: false,
}

/** Row heights in px. */
export const ROW_HEIGHT: Record<ScenarioRowHeight, number> = {short: 36, tall: 72}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []

/** A saved view, checked field by field: anything unknown takes the default. */
export function parseScenarioView(raw: unknown): ScenarioView {
    if (!isRecord(raw)) return DEFAULT_SCENARIO_VIEW
    const widths = isRecord(raw.widths)
        ? Object.fromEntries(
              Object.entries(raw.widths).filter(
                  (entry): entry is [string, number] =>
                      typeof entry[1] === "number" && entry[1] > 0,
              ),
          )
        : {}
    return {
        density: raw.density === "comfortable" ? "comfortable" : "compact",
        rowHeight: raw.rowHeight === "tall" ? "tall" : "short",
        ...(raw.label === null || typeof raw.label === "string" ? {label: raw.label} : {}),
        hide: strings(raw.hide),
        show: strings(raw.show),
        order: strings(raw.order),
        widths,
        orderByFailures: raw.orderByFailures === true,
    }
}

const LONG_TEXT: ReadonlySet<ValueShape | null> = new Set(["text-long", "markdown"])

/** True for a column Compact hides by default: long text and the app output. */
const compactHides = (column: ScenarioFieldColumn) =>
    column.section === "output" || LONG_TEXT.has(column.shape)

/**
 * The columns hidden by default: text metrics (reasons and JSON outputs), and in Compact the
 * long text and output columns.
 */
export function defaultHiddenKeys(
    model: ScenarioColumnModel,
    density: ScenarioDensity,
): Set<string> {
    const hidden = new Set<string>()
    for (const group of model.evaluators) {
        for (const column of group.columns) {
            if (column.metricKind === "text") hidden.add(column.key)
        }
    }
    if (density === "compact") {
        for (const column of model.fields) if (compactHides(column)) hidden.add(column.key)
    }
    return hidden
}

/** The hidden columns: the defaults, with the user's changes. */
export function hiddenKeys(
    model: ScenarioColumnModel,
    view: Pick<ScenarioView, "density" | "hide" | "show">,
): Set<string> {
    const hidden = defaultHiddenKeys(model, view.density)
    for (const key of view.show) hidden.delete(key)
    for (const key of view.hide) hidden.add(key)
    return hidden
}

/** Hide or show columns: a change to a default is kept, a change back to it is dropped. */
export function setColumnsHidden(
    view: ScenarioView,
    model: ScenarioColumnModel,
    keys: readonly string[],
    hidden: boolean,
): ScenarioView {
    const defaults = defaultHiddenKeys(model, view.density)
    const hide = new Set(view.hide)
    const show = new Set(view.show)
    for (const key of keys) {
        hide.delete(key)
        show.delete(key)
        if (hidden && !defaults.has(key)) hide.add(key)
        if (!hidden && defaults.has(key)) show.add(key)
    }
    return {...view, hide: [...hide], show: [...show]}
}

/**
 * A new density. Its widths differ, so the user's widths go, and the columns Compact hides by
 * default follow the new density again.
 */
export function withDensity(
    view: ScenarioView,
    model: ScenarioColumnModel,
    density: ScenarioDensity,
): ScenarioView {
    const follow = new Set(model.fields.filter(compactHides).map((column) => column.key))
    return {
        ...view,
        density,
        widths: {},
        hide: view.hide.filter((key) => !follow.has(key)),
        show: view.show.filter((key) => !follow.has(key)),
    }
}

/** The label column: the user's pick, else the first short text column of the test case. */
export function labelColumnKey(model: ScenarioColumnModel, view: ScenarioView): string | null {
    if (view.label === null) return null
    const testcase = model.fields.filter((column) => column.section === "testcase")
    if (view.label !== undefined && testcase.some((column) => column.key === view.label)) {
        return view.label
    }
    return testcase.find((column) => column.shape === "text-short")?.key ?? null
}

/** Items in the user's order; items the order does not name follow in their own order. */
export function orderedByKeys<T extends {key: string}>(items: readonly T[], order: string[]): T[] {
    const position = new Map(order.map((key, index) => [key, index]))
    const named = items
        .filter((item) => position.has(item.key))
        .sort((a, b) => (position.get(a.key) ?? 0) - (position.get(b.key) ?? 0))
    return [...named, ...items.filter((item) => !position.has(item.key))]
}

/** Move one key before another in the order of a list of keys. */
export function moveKey(keys: readonly string[], key: string, before: string): string[] {
    if (key === before) return [...keys]
    const rest = keys.filter((item) => item !== key)
    const index = rest.indexOf(before)
    if (index < 0) return [...rest, key]
    return [...rest.slice(0, index), key, ...rest.slice(index)]
}

/** The width of a column before the user drags it, in px. */
export function defaultColumnWidth(column: ScenarioColumn, density: ScenarioDensity): number {
    const compact = density === "compact"
    if (column.type === "metric") return 96
    if (column.type === "evaluator") {
        switch (column.metricKind) {
            case "binary":
            case "numeric":
                return compact ? 64 : 80
            case "text":
                return compact ? 220 : 260
            default:
                return compact ? 96 : 120
        }
    }
    if (column.section === "output") return 280
    switch (column.shape) {
        case "number":
        case "boolean":
            return 96
        case "text-short":
        case "url":
        case null:
            return 160
        default:
            return 240
    }
}

/** The lead columns' widths, in px: number, status (wider when a row shows a word), label. */
export const LEAD_WIDTH = {
    index: 40,
    status: 28,
    statusWithWord: 96,
    run: 160,
    annotate: 104,
    label: {compact: 220, comfortable: 240},
} as const
