import {useMemo} from "react"

import {executionItemController} from "@agenta/playground"
import ControlsBar from "@agenta/playground-ui/chat-controls"
import {useAtomValue} from "jotai"

interface Props {
    logicalId: string
    onRun: () => void
    onCancelAll: () => void
    onAddMessage: () => void
    className?: string
}

/**
 * OSS LastTurnFooterControls — reads isAnyRunning from atom.
 *
 * Onboarding tracking is no longer injected here: ControlsBar (@agenta/playground-ui)
 * fires the "playground_ran_prompt" event itself, importing recordWidgetEvent from
 * @agenta/onboarding/state directly.
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

    return (
        <ControlsBar
            isRunning={isAnyRunning}
            onRun={onRun}
            onCancel={onCancelAll}
            onAddMessage={onAddMessage}
            className={className ?? "p-3 pl-0"}
        />
    )
}

export default LastTurnFooterControls
