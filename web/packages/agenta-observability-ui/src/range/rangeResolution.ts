import {createT} from "@agenta/i18n"
import rangeCatalog from "@agenta/i18n/catalogs/observabilityUi.range"
import {
    ALL_TIME_START,
    resolveRangePreset,
    type SortResult,
    type SortTypes,
} from "@agenta/observability"

const tNow = createT(rangeCatalog)

type PresetLabel = Exclude<SortTypes, "custom" | "all time" | "">

const PRESET_KEYS = {
    "30 mins": {row: "observabilityUi.range.row30Mins", last: "observabilityUi.range.last30Mins"},
    "1 hour": {row: "observabilityUi.range.row1Hour", last: "observabilityUi.range.last1Hour"},
    "6 hours": {row: "observabilityUi.range.row6Hours", last: "observabilityUi.range.last6Hours"},
    "24 hours": {
        row: "observabilityUi.range.row24Hours",
        last: "observabilityUi.range.last24Hours",
    },
    "3 days": {row: "observabilityUi.range.row3Days", last: "observabilityUi.range.last3Days"},
    "7 days": {row: "observabilityUi.range.row7Days", last: "observabilityUi.range.last7Days"},
    "14 days": {row: "observabilityUi.range.row14Days", last: "observabilityUi.range.last14Days"},
    "1 month": {row: "observabilityUi.range.row1Month", last: "observabilityUi.range.last1Month"},
    "3 months": {
        row: "observabilityUi.range.row3Months",
        last: "observabilityUi.range.last3Months",
    },
} as const satisfies Record<PresetLabel, {row: string; last: string}>

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
export const presetRowLabel = (label: SortTypes): string => {
    if (label === "all time") return tNow("observabilityUi.range.allTime")
    const keys = PRESET_KEYS[label as PresetLabel]
    return keys ? tNow(keys.row) : label
}

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
    if (style === "compact") {
        if (label === "custom") return tNow("observabilityUi.range.custom")
        return label === "all time"
            ? tNow("observabilityUi.range.allTimeCompact")
            : presetRowLabel(label)
    }
    if (label === "custom") return tNow("observabilityUi.range.customDate")
    if (label === "all time") return tNow("observabilityUi.range.allTime")
    if (!label) return tNow("observabilityUi.range.sortByDate")
    const keys = PRESET_KEYS[label as PresetLabel]
    return keys ? tNow(keys.last) : label
}
