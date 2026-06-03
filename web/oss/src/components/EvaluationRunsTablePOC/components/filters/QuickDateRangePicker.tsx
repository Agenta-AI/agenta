import {useCallback, useMemo} from "react"

import Sort, {type SortResult} from "@/oss/components/Filters/Sort"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"

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

interface SortPresetMeta {
    label: SortOptionValue
    amount?: number
    unit?: dayjs.ManipulateType
}

const SORT_PRESETS: SortPresetMeta[] = [
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

const KNOWN_SORT_VALUES = new Set<SortOptionValue>([
    ...SORT_PRESETS.map((preset) => preset.label),
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

    for (const preset of SORT_PRESETS) {
        if (!preset.amount || !preset.unit) continue
        const expectedFrom = to.subtract(preset.amount, preset.unit)
        if (Math.abs(expectedFrom.diff(from, "minute")) <= 1) {
            return preset.label
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

interface QuickDateRangePickerProps {
    value: RangeValue
    onChange: (range: RangeValue) => void
}

const QuickDateRangePicker = ({value, onChange}: QuickDateRangePickerProps) => {
    const defaultSortValue = useMemo(
        () => detectSortValue(value),
        [value?.from, value?.to, value?.preset],
    )
    const sortComponentKey = useMemo(() => {
        return `${defaultSortValue}:${value?.from ?? "null"}:${value?.to ?? "null"}`
    }, [defaultSortValue, value?.from, value?.to])

    const handleSortApply = useCallback(
        (result: SortResult) => {
            const nextRange = convertSortResultToRange(result)
            onChange(nextRange)
        },
        [onChange],
    )

    return (
        <Sort
            key={sortComponentKey}
            defaultSortValue={defaultSortValue}
            onSortApply={handleSortApply}
        />
    )
}

export default QuickDateRangePicker
