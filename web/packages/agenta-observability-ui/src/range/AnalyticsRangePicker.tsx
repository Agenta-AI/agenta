import {observabilityRangeAtom, type AnalyticsRangeLabel} from "@agenta/observability"
import {useAtom} from "jotai"

import {RangePicker} from "./RangePicker"

export interface AnalyticsRangePickerProps {
    /** Labels to leave out — "all time" is meaningless on a usage summary. */
    exclude?: AnalyticsRangeLabel[]
}

/**
 * The window the usage figures cover — the compact trigger that sits in the 340px rail card on
 * both apps. Moved here from `@agenta/home-ui` so Home and the observability toolbar render one
 * preset list; the custom start/end branch it used to omit now comes free from `RangePicker`,
 * though this surface still excludes it by default.
 */
export const AnalyticsRangePicker = ({
    exclude = ["all time", "custom"],
}: AnalyticsRangePickerProps) => {
    const [range, setRange] = useAtom(observabilityRangeAtom)

    return (
        <RangePicker
            trigger="inline"
            ariaLabel="Usage date range"
            fallbackLabel="1 month"
            exclude={exclude}
            value={range}
            onChange={setRange}
        />
    )
}

export default AnalyticsRangePicker
