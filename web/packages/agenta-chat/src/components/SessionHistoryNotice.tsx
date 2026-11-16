import {useT} from "@agenta/i18n"
import chatSessionHistoryNoticeCatalog from "@agenta/i18n/catalogs/chat.sessionHistoryNotice"
import {cn} from "@agenta/ui/ui"
import {CircleNotch, WarningCircle} from "@phosphor-icons/react"

export type SessionHistoryNoticeState = "reconnecting" | "incomplete"

/** User-visible reconnect/history integrity states. */
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
                reconnecting
                    ? "border-colorBorder bg-colorFillQuaternary"
                    : "border-colorWarningBorder bg-colorWarningBg",
                className,
            )}
            role="status"
        >
            {reconnecting ? (
                <CircleNotch
                    aria-hidden
                    className="text-colorInfo mt-0.5 shrink-0 animate-spin"
                    size={16}
                />
            ) : (
                <WarningCircle
                    aria-hidden
                    className="text-colorWarning mt-0.5 shrink-0"
                    size={16}
                />
            )}
            <span className="min-w-0">
                <span className="text-colorText block text-xs font-medium">{copy.title}</span>
                <span className="text-colorTextSecondary block text-xs">{copy.detail}</span>
            </span>
        </div>
    )
}
