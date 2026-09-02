import {useCallback} from "react"

import {realtimeModeAtom} from "@agenta/observability"
import {Segmented, type SegmentedProps, type SegmentedValue} from "@agenta/ui/ui"
import {useAtom} from "jotai"

const REALTIME_OPTIONS: SegmentedProps["options"] = [
    {label: "All activity", value: "all"},
    {label: "Latest activity", value: "latest"},
]

/**
 * Sessions-only. "All activity" is the stable `first_active` ordering; "Latest activity" is the
 * unstable `last_active` one that reshuffles as traffic arrives.
 */
export const RealtimeModeControl = () => {
    const [realtimeMode, setRealtimeMode] = useAtom(realtimeModeAtom)

    const onChange = useCallback(
        (value: SegmentedValue) => setRealtimeMode(value === "latest"),
        [setRealtimeMode],
    )

    return (
        <Segmented
            aria-label="Session activity ordering"
            options={REALTIME_OPTIONS}
            value={realtimeMode ? "latest" : "all"}
            onChange={onChange}
        />
    )
}

export default RealtimeModeControl
