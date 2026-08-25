import {
    ALL_TIME_START,
    resolveRangePreset,
    type SortResult,
    type SortTypes,
} from "@agenta/observability"

export type CustomRange = NonNullable<SortResult["customRange"]>

/** @deprecated The epoch start `resolveRangePreset` now returns for "all time" on its own. */
export const ALL_TIME_SENTINEL = ALL_TIME_START

/** A preset label → the `{type, sorted, customRange, label}` payload the query layer takes. */
export const resolvePresetRange = (label: SortTypes): SortResult => resolveRangePreset(label)

/** An explicit start/end → the same payload shape. Empty sides are dropped, as antd's was. */
export const resolveCustomRange = (range: CustomRange): SortResult => {
    const customRange: CustomRange = {}
    if (range.startTime) customRange.startTime = range.startTime
    if (range.endTime) customRange.endTime = range.endTime
    return {type: "custom", sorted: "", customRange, label: "custom"}
}

/**
 * Which row the menu marks as selected. Derived from the applied range only — `fallback` covers
 * `DEFAULT_SORT`, which is a real 24h window that carries no label.
 */
export const selectedRangeLabel = (
    range: SortResult | undefined,
    fallback: SortTypes = "24 hours",
): SortTypes => {
    if (!range) return fallback
    if (range.type === "custom") return "custom"
    return range.label || fallback
}

/** The preset menu row's text: only "all time" is re-cased. */
export const presetRowLabel = (label: SortTypes): string =>
    label === "all time" ? "All time" : label

/**
 * The trigger readout. `verbose` is the observability toolbar button ("Last 24 hours"),
 * `compact` the inline Home trigger, which shows the bare preset name.
 */
export const formatRangeLabel = (
    range: SortResult | undefined,
    fallback: SortTypes = "24 hours",
    style: "verbose" | "compact" = "verbose",
): string => {
    const label = selectedRangeLabel(range, fallback)
    if (style === "compact") return label === "custom" ? "Custom" : label
    if (label === "custom") return "Custom date"
    if (label === "all time") return "All time"
    if (!label) return "Sort by Date"
    return `Last ${label}`
}
