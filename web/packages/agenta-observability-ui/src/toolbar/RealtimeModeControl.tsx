import {useCallback} from "react"

import {useT} from "@agenta/i18n"
import toolbarCatalog from "@agenta/i18n/catalogs/observabilityUi.toolbar"
import {realtimeModeAtom} from "@agenta/observability"
import {Segmented, type SegmentedProps, type SegmentedValue} from "@agenta/ui/ui"
import {useAtom} from "jotai"

/**
 * Sessions-only. "All activity" is the stable `first_active` ordering; "Latest activity" is the
 * unstable `last_active` one that reshuffles as traffic arrives.
 */
export const RealtimeModeControl = () => {
    const t = useT(toolbarCatalog)
    const options: SegmentedProps["options"] = [
        {label: t("observabilityUi.toolbar.allActivity"), value: "all"},
        {label: t("observabilityUi.toolbar.latestActivity"), value: "latest"},
    ]
    const [realtimeMode, setRealtimeMode] = useAtom(realtimeModeAtom)

    const onChange = useCallback(
        (value: SegmentedValue) => setRealtimeMode(value === "latest"),
        [setRealtimeMode],
    )

    return (
        <Segmented
            aria-label={t("observabilityUi.toolbar.sessionOrdering")}
            options={options}
            value={realtimeMode ? "latest" : "all"}
            onChange={onChange}
        />
    )
}

export default RealtimeModeControl
