import {useT} from "@agenta/i18n"
import chatConnectionWarningStripCatalog from "@agenta/i18n/catalogs/chat.connectionWarningStrip"
import {cn} from "@agenta/ui/ui"
import {WarningCircle} from "@phosphor-icons/react"

/** Ephemeral sender-connection state; the accepted turn remains owned by the session. */
export const ConnectionWarningStrip = ({
    message,
    className,
}: {
    message: string
    className?: string
}) => {
    const t = useT(chatConnectionWarningStripCatalog)
    return (
        <div
            className={cn(
                "mb-2 box-border flex items-start gap-2 rounded-lg border border-solid px-3 py-2",
                "border-warning/30 bg-warning/10",
                className,
            )}
            role="status"
        >
            <WarningCircle aria-hidden className="text-warning mt-0.5 shrink-0" size={16} />
            <span className="min-w-0">
                <span className="text-foreground block text-label">
                    {t("chat.connectionWarningStrip.interrupted")}
                </span>
                <span className="text-muted-foreground block text-meta">{message}</span>
            </span>
        </div>
    )
}
