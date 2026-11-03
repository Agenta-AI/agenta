import {RunButton} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"

export interface ChatControlsProps {
    isRunning: boolean
    onRun: () => void
    onCancel: () => void
    onAddMessage: () => void
}

/** Under the last turn: Run (Cancel while it runs) and the button that adds a user message. */
export const ChatControls = ({isRunning, onRun, onCancel, onAddMessage}: ChatControlsProps) => (
    <div className="flex items-center gap-2 py-3">
        {isRunning ? (
            <RunButton mode="cancel" onClick={onCancel} size="sm" />
        ) : (
            <RunButton onClick={onRun} size="sm" />
        )}
        <Button variant="outline" size="sm" disabled={isRunning} onClick={onAddMessage}>
            <Plus size={14} />
            Message
        </Button>
    </div>
)
