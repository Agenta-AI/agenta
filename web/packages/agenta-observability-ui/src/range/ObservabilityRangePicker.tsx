import {sortAtom} from "@agenta/observability"
import {useAtom} from "jotai"

import {RangePicker, type RangePickerProps} from "./RangePicker"

export type ObservabilityRangePickerProps = Omit<RangePickerProps, "value" | "onChange">

/**
 * The traces/sessions toolbar range picker, bound to `sortAtom`.
 *
 * `sortAtom` is per-tab, so the readout follows the window the tab's query is actually using.
 */
export const ObservabilityRangePicker = (props: ObservabilityRangePickerProps) => {
    const [range, setRange] = useAtom(sortAtom)
    return <RangePicker {...props} value={range} onChange={setRange} />
}

export default ObservabilityRangePicker
