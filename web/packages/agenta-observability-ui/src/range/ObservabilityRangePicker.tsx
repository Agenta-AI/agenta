import {sortAtom} from "@agenta/observability"
import {useAtom} from "jotai"

import {RangePicker, type RangePickerProps} from "./RangePicker"

export type ObservabilityRangePickerProps = Omit<RangePickerProps, "value" | "onChange">

/**
 * The traces/sessions toolbar range picker, bound to `sortAtom`.
 *
 * `sortAtom` is per-tab, so the readout follows the window the tab's query is actually using.
 * The antd original seeded local state from a hardcoded `defaultSortValue="24 hours"` prop and
 * never synced back, so a tab round-trip re-labelled a live "All time" window as "Last 24 hours".
 */
export const ObservabilityRangePicker = (props: ObservabilityRangePickerProps) => {
    const [range, setRange] = useAtom(sortAtom)
    return <RangePicker {...props} value={range} onChange={setRange} />
}

export default ObservabilityRangePicker
