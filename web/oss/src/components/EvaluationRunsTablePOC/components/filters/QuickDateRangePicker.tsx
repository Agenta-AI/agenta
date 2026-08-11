import {useCallback, useMemo} from "react"

import {ANALYTICS_RANGE_PRESETS, type SortResult} from "@agenta/observability"
import {ALL_TIME_SENTINEL, RangePicker} from "@agenta/observability-ui"
import {dayjs} from "@agenta/shared/utils/dateTime"

type RangeValue = {from?: string | null; to?: string | null; preset?: string | null} | null

type SortOptionValue =
    | "30 mins"
    | "1 hour"
    | "6 hours"
    | "24 hours"
    | "3 days"
    | "7 days"
    | "14 days"
    | "1 month"
    | "3 months"
    | "all time"
    | "custom"

const KNOWN_SORT_VALUES = new Set<SortOptionValue>([
    ...ANALYTICS_RANGE_PRESETS.map((preset) => preset.label as SortOptionValue),
    "custom",
])

const isKnownSortValue = (preset?: string | null): preset is SortOptionValue =>
    !!preset && KNOWN_SORT_VALUES.has(preset as SortOptionValue)

const detectSortValue = (value: RangeValue): SortOptionValue => {
    if (!value || (!value.from && !value.to)) {
        return "all time"
    }
    // Prefer an explicit, recognized preset. Relative presets are stored with an
    // open-ended upper bound (`to: null`) so the window always extends to "now";
    // without this they'd fall into the `!value.to` branch below and mislabel as
    // "custom".
    if (isKnownSortValue(value.preset)) {
        return value.preset
    }
    if (!value.from || !value.to) {
        return "custom"
    }

    const from = dayjs(value.from)
    const to = dayjs(value.to)
    if (!from.isValid() || !to.isValid()) {
        return "custom"
    }

    for (const preset of ANALYTICS_RANGE_PRESETS) {
        if (!preset.amount || !preset.unit) continue
        const expectedFrom = to.subtract(preset.amount, preset.unit)
        if (Math.abs(expectedFrom.diff(from, "minute")) <= 1) {
            return preset.label as SortOptionValue
        }
    }

    return "custom"
}

const convertSortResultToRange = (result: SortResult): RangeValue => {
    if (result.type === "standard") {
        if (!result.sorted || result.sorted.startsWith("1970")) {
            return null
        }
        const from = dayjs.utc(result.sorted).toISOString()
        // Derive the preset label from a concrete window, then drop the upper
        // bound. Relative presets are stored open-ended (`to: null`) so the window
        // always extends to "now" — matching the default range and Refresh. A
        // fixed `to` captured here would freeze the upper bound at selection time,
        // hiding events created afterward until a manual refresh.
        const preset = detectSortValue({from, to: dayjs().utc().toISOString()})
        return {from, to: null, preset}
    }

    const from = result.customRange?.startTime
        ? dayjs.utc(result.customRange.startTime).toISOString()
        : null
    const to = result.customRange?.endTime
        ? dayjs.utc(result.customRange.endTime).toISOString()
        : null

    if (!from && !to) {
        return null
    }

    return {from, to, preset: "custom"}
}

/** The inverse of `convertSortResultToRange`: this surface stores its own `{from,to,preset}`. */
const convertRangeToSortResult = (value: RangeValue): SortResult => {
    const label = detectSortValue(value)
    if (label === "custom") {
        const customRange: NonNullable<SortResult["customRange"]> = {}
        if (value?.from) customRange.startTime = value.from
        if (value?.to) customRange.endTime = value.to
        return {type: "custom", sorted: "", customRange, label: "custom"}
    }
    return {
        type: "standard",
        sorted: value?.from ?? ALL_TIME_SENTINEL,
        label,
    }
}

interface QuickDateRangePickerProps {
    value: RangeValue
    onChange: (range: RangeValue) => void
}

const QuickDateRangePicker = ({value, onChange}: QuickDateRangePickerProps) => {
    const range = useMemo(
        () => convertRangeToSortResult(value),
        [value?.from, value?.to, value?.preset],
    )

    const handleSortApply = useCallback(
        (result: SortResult) => {
            onChange(convertSortResultToRange(result))
        },
        [onChange],
    )

    return <RangePicker value={range} onChange={handleSortApply} />
}

export default QuickDateRangePicker
