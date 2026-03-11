import {useCallback, useMemo} from "react"

import {executionItemController} from "@agenta/playground"
import ControlsBar from "@agenta/playground-ui/chat-controls"
import {useAtomValue, useSetAtom} from "jotai"

import {recordWidgetEventAtom} from "@/oss/lib/onboarding"

interface Props {
    logicalId: string
    onRun: () => void
    onCancelAll: () => void
    onAddMessage: () => void
    className?: string
}

/**
 * OSS LastTurnFooterControls — reads isAnyRunning from atom and injects onboarding tracking.
 */
const LastTurnFooterControls: React.FC<Props> = ({
    logicalId,
    onRun,
    onCancelAll,
    onAddMessage,
    className,
}) => {
    const isAnyRunning = useAtomValue(
        useMemo(() => executionItemController.selectors.isAnyRunningForRow(logicalId), [logicalId]),
    ) as boolean

    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)
    const onTrackRun = useCallback(() => {
        recordWidgetEvent("playground_ran_prompt")
    }, [recordWidgetEvent])

    return (
        <ControlsBar
            isRunning={isAnyRunning}
            onRun={onRun}
            onCancel={onCancelAll}
            onAddMessage={onAddMessage}
            onTrackRun={onTrackRun}
            className={className ?? "p-3 pl-0"}
        />
    )
}

export default LastTurnFooterControls
