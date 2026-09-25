import {Button} from "@agenta/ui/ui"
import {Broadcast} from "@phosphor-icons/react"

export interface PublishButtonProps {
    onClick: () => void
    disabled?: boolean
    className?: string
}

/** The agent header's Publish button; it opens the Publish panel. */
export const PublishButton = ({onClick, disabled, className}: PublishButtonProps) => (
    <Button
        variant="outline"
        size="sm"
        className={className}
        disabled={disabled}
        onClick={onClick}
        data-testid="publish-button"
    >
        <Broadcast data-icon="inline-start" />
        Publish
    </Button>
)
