import dayjs from "dayjs"
import utc from "dayjs/plugin/utc"

import type {AnalyticsRange, AnalyticsRangeLabel} from "./types"

dayjs.extend(utc)

export interface AnalyticsRangePreset {
    label: AnalyticsRangeLabel
    amount?: number
    unit?: dayjs.ManipulateType
}

/**
 * Second-precision ISO in UTC. The `Z` is load-bearing: the value is re-parsed with `dayjs()`
 * before the request, and a designator-less string reads as LOCAL time — which shifts the
 * window by the browser's offset and, west of UTC, inverts short ranges outright.
 */
export const toRangeStart = (value: dayjs.Dayjs): string =>
    value.toISOString().replace(/\.\d+Z$/, "Z")

/** `all time` has no real lower bound; the epoch is the one the range picker has always sent. */
export const ALL_TIME_START = "1970-01-01T00:00:00Z"

/** The windows every range picker offers. `all time` carries no offset. */
export const ANALYTICS_RANGE_PRESETS: AnalyticsRangePreset[] = [
    {label: "30 mins", amount: 30, unit: "minute"},
    {label: "1 hour", amount: 1, unit: "hour"},
    {label: "6 hours", amount: 6, unit: "hour"},
    {label: "24 hours", amount: 24, unit: "hour"},
    {label: "3 days", amount: 3, unit: "day"},
    {label: "7 days", amount: 7, unit: "day"},
    {label: "14 days", amount: 14, unit: "day"},
    {label: "1 month", amount: 1, unit: "month"},
    {label: "3 months", amount: 3, unit: "month"},
    {label: "all time"},
]

/**
 * A preset label → the resolved window the query takes. `all time` (and any label with no
 * offset, e.g. `custom`, which carries its bounds separately) resolves to the epoch rather
 * than to an empty string, which `fetchDashboardAnalytics` would reject as an invalid start.
 */
export const resolveRangePreset = (label: AnalyticsRangeLabel): AnalyticsRange => {
    const preset = ANALYTICS_RANGE_PRESETS.find((entry) => entry.label === label)
    const sorted =
        preset?.amount && preset.unit
            ? toRangeStart(dayjs().utc().subtract(preset.amount, preset.unit))
            : ALL_TIME_START
    return {type: "standard", sorted, customRange: {}, label}
}
