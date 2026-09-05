import {cn} from "@agenta/ui/ui"
import {CircleNotch, WarningCircle} from "@phosphor-icons/react"

export type SessionHistoryNoticeState = "reconnecting" | "incomplete"

const COPY: Record<SessionHistoryNoticeState, {title: string; detail: string}> = {
    reconnecting: {
        title: "Reconnecting to this session",
        detail: "Restoring the durable transcript before live updates resume.",
    },
    incomplete: {
        title: "Some earlier history is unavailable",
        detail: "New activity will keep updating, but this transcript may be missing older events.",
    },
}

/** User-visible reconnect/history integrity states shared by desktop and mobile chat surfaces. */
export const SessionHistoryNotice = ({
    state,
    className,
}: {
    state: SessionHistoryNoticeState
    className?: string
}) => {
    const copy = COPY[state]
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
