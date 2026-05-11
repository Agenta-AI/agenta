import {useCallback} from "react"

import ControlsBarBase, {type ControlsBarProps} from "@agenta/playground-ui/chat-controls"
import {useSetAtom} from "jotai"

import {recordWidgetEventAtom} from "@/oss/lib/onboarding"

/**
 * OSS ControlsBar — wraps the package component with onboarding tracking.
 */
const ControlsBar = (props: Omit<ControlsBarProps, "onTrackRun">) => {
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)
    const onTrackRun = useCallback(() => {
        recordWidgetEvent("playground_ran_prompt")
    }, [recordWidgetEvent])

    return <ControlsBarBase {...props} onTrackRun={onTrackRun} />
}

export default ControlsBar
