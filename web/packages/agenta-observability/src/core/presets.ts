import {dayjs} from "@agenta/shared/utils/dateTime"
import utc from "dayjs/plugin/utc"

import type {AnalyticsRange, AnalyticsRangeLabel} from "./types"

dayjs.extend(utc)

export interface AnalyticsRangePreset {
    label: AnalyticsRangeLabel
    amount?: number
    unit?: dayjs.ManipulateType
}

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
 * Second-precision UTC, designator kept. The `Z` is load-bearing: the query layer reparses this
 * string with `dayjs()`, which reads a bare `2026-08-15T17:20:00` as LOCAL time, so dropping it
 * skewed every preset window by the viewer's offset (three hours in UTC+3).
 */
export const toRangeInstant = (value: dayjs.Dayjs): string =>
    `${value.utc().toISOString().split(".")[0]}Z`

/** "all time" still needs a real start — the analytics fetch throws on an empty one. */
export const ALL_TIME_START = "1970-01-01T00:00:00Z"

/** A preset label → the resolved window the query takes. */
export const resolveRangePreset = (label: AnalyticsRangeLabel): AnalyticsRange => {
    const preset = ANALYTICS_RANGE_PRESETS.find((entry) => entry.label === label)
    const sorted =
        preset?.amount && preset.unit
            ? toRangeInstant(dayjs().subtract(preset.amount, preset.unit))
            : ALL_TIME_START
    return {type: "standard", sorted, customRange: {}, label}
}
