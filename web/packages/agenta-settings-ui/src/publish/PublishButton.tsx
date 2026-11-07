import {useT} from "@agenta/i18n/publish"
import {Button} from "@agenta/ui/ui"
import {Broadcast} from "@phosphor-icons/react"

export interface PublishButtonProps {
    onClick: () => void
    disabled?: boolean
    className?: string
}

/** The agent header's Publish button; it opens the Publish panel. */
export const PublishButton = ({onClick, disabled, className}: PublishButtonProps) => {
    const t = useT()
    return (
        <Button
            size="sm"
            // The design's one yellow action per screen: the hero-action token.
            className={`bg-hero-action text-hero-action-foreground hover:bg-hero-action-hover ${className ?? ""}`}
            disabled={disabled}
            onClick={onClick}
            data-testid="publish-button"
        >
            <Broadcast data-icon="inline-start" />
            {t("publish.publish")}
        </Button>
    )
}
