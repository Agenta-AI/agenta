import {cn} from "@agenta/ui/ui"
import {WarningCircle} from "@phosphor-icons/react"

/** Ephemeral sender-connection state; the accepted turn remains owned by the session. */
export const ConnectionWarningStrip = ({
    message,
    className,
}: {
    message: string
    className?: string
}) => (
    <div
        className={cn(
            "mb-2 box-border flex items-start gap-2 rounded-lg border border-solid px-3 py-2",
            "border-colorWarningBorder bg-colorWarningBg",
            className,
        )}
        role="status"
    >
        <WarningCircle aria-hidden className="text-colorWarning mt-0.5 shrink-0" size={16} />
        <span className="min-w-0">
            <span className="text-colorText block text-xs font-medium">Connection interrupted</span>
            <span className="text-colorTextSecondary block text-xs">{message}</span>
        </span>
    </div>
)
