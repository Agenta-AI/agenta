import {useCallback} from "react"

import {
    RunButton as PackageRunButton,
    type RunButtonProps,
} from "@agenta/ui/components/presentational"
import {useSetAtom} from "jotai"

import {recordWidgetEventAtom} from "@/oss/lib/onboarding"

/**
 * OSS wrapper around the package RunButton that injects onboarding event tracking.
 */
const RunButton = (props: Omit<RunButtonProps, "onTrackRun">) => {
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)
    const handleTrack = useCallback(() => {
        recordWidgetEvent("playground_ran_prompt")
    }, [recordWidgetEvent])

    return <PackageRunButton {...props} onTrackRun={handleTrack} />
}

export default RunButton
