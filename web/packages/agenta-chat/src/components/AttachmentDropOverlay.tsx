import {DownloadSimple} from "@phosphor-icons/react"

export interface AttachmentDropOverlayProps {
    /** A drag carrying files is over the target. */
    active: boolean
    /** The tray is full, so this drop would be rejected wholesale. */
    atMax?: boolean
    /** What the tray accepts, shown as the secondary line. */
    hint?: string
    className?: string
}

/**
 * The "drop files here" state for whatever owns the drop target. At the limit it says so rather
 * than inviting a drop it is about to reject.
 */
export const AttachmentDropOverlay = ({
    active,
    atMax = false,
    hint,
    className,
}: AttachmentDropOverlayProps) => {
    if (!active) return null
    return (
        <div
            className={`pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed ${
                atMax
                    ? "border-colorError bg-colorErrorBg"
                    : "border-colorWarning bg-colorWarningBg"
            } ${className ?? ""}`}
        >
            <DownloadSimple size={24} className={atMax ? "text-colorError" : "text-colorText"} />
            <span className={`text-sm font-medium ${atMax ? "text-colorError" : "text-colorText"}`}>
                {atMax ? "Attachment limit reached" : "Drop to attach"}
            </span>
            {hint && <span className="text-xs text-colorTextSecondary">{hint}</span>}
        </div>
    )
}

export default AttachmentDropOverlay
