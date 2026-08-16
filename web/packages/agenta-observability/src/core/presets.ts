import dayjs from "dayjs"
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

/** A preset label → the resolved window the query takes. */
export const resolveRangePreset = (label: AnalyticsRangeLabel): AnalyticsRange => {
    const preset = ANALYTICS_RANGE_PRESETS.find((entry) => entry.label === label)
    const sorted =
        preset?.amount && preset.unit
            ? dayjs().utc().subtract(preset.amount, preset.unit).toISOString().split(".")[0]
            : ""
    return {type: "standard", sorted, customRange: {}, label}
}
