import {useT} from "@agenta/i18n"
import chatSessionHistoryNoticeCatalog from "@agenta/i18n/catalogs/chat.sessionHistoryNotice"
import {cn, Spinner} from "@agenta/ui/ui"
import {WarningCircle} from "@phosphor-icons/react"

export type SessionHistoryNoticeState = "reconnecting" | "incomplete"

/** User-visible reconnect/history integrity states shared by desktop and mobile chat surfaces. */
export const SessionHistoryNotice = ({
    state,
    className,
}: {
    state: SessionHistoryNoticeState
    className?: string
}) => {
    const t = useT(chatSessionHistoryNoticeCatalog)
    const copy =
        state === "reconnecting"
            ? {
                  title: t("chat.sessionHistoryNotice.reconnectingTitle"),
                  detail: t("chat.sessionHistoryNotice.reconnectingDetail"),
              }
            : {
                  title: t("chat.sessionHistoryNotice.incompleteTitle"),
                  detail: t("chat.sessionHistoryNotice.incompleteDetail"),
              }
    const reconnecting = state === "reconnecting"

    return (
        <div
            className={cn(
                "box-border flex items-start gap-2 rounded-lg border border-solid px-3 py-2",
                reconnecting ? "border-border bg-secondary" : "border-warning/30 bg-warning/10",
                className,
            )}
            role="status"
        >
            {reconnecting ? (
                <Spinner aria-hidden className="text-info mt-0.5" />
            ) : (
                <WarningCircle aria-hidden className="text-warning mt-0.5 shrink-0" size={16} />
            )}
            <span className="min-w-0">
                <span className="text-foreground block text-label">{copy.title}</span>
                <span className="text-muted-foreground block text-meta">{copy.detail}</span>
            </span>
        </div>
    )
}
