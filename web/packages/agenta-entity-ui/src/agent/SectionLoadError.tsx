import {Button} from "@agenta/ui/ui"
import {WarningCircleIcon} from "@phosphor-icons/react"

/** A failed request must not read as an empty configuration — say it broke, and offer the retry. */
export const SectionLoadError = ({message, onRetry}: {message: string; onRetry: () => void}) => (
    <div className="flex items-center justify-between gap-3 px-2 py-3">
        <span className="flex min-w-0 items-center gap-2 text-xs text-colorTextSecondary">
            <WarningCircleIcon size={16} className="shrink-0 text-colorError" />
            <span className="min-w-0 truncate">{message}</span>
        </span>
        <Button size="sm" variant="outline" className="shrink-0" onClick={onRetry}>
            Retry
        </Button>
    </div>
)
