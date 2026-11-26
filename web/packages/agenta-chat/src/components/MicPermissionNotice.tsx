import {useRef} from "react"

import {useT} from "@agenta/i18n"
import chatMicPermissionNoticeCatalog from "@agenta/i18n/catalogs/chat.micPermissionNotice"
import {WarningCircle} from "@phosphor-icons/react"

import RevealCollapse from "./RevealCollapse"

/**
 * Mic permission / recording-failure notice above the composer. Mirrors `ConnectModelBanner`: it
 * enters and leaves through `RevealCollapse` (the shared composer-chrome idiom) instead of
 * popping, and latches its message so the text survives the leave transition.
 */
const MicPermissionNotice = ({
    message,
    open,
    onDismiss,
    className,
}: {
    message: string | null
    open: boolean
    onDismiss: () => void
    className?: string
}) => {
    // Latch so the notice keeps its text while it collapses closed.
    const t = useT(chatMicPermissionNoticeCatalog)
    const messageRef = useRef("")
    if (message) messageRef.current = message

    return (
        <RevealCollapse open={open} className={className}>
            {/* Token classes, not `--ant-color-*`: antd generates those, and this now renders on
                mobile too, where nothing defines them. */}
            <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-solid border-colorErrorBorder bg-colorErrorBg px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-xs text-colorError">
                    <WarningCircle size={14} weight="fill" className="shrink-0" />
                    <span className="truncate">{messageRef.current}</span>
                </span>
                <button
                    type="button"
                    onClick={onDismiss}
                    // A phone: 44 px high, into the row's padding. Not an after area: the reveal
                    // around the notice clips its overflow.
                    className="shrink-0 cursor-pointer rounded border-0 bg-transparent text-xs text-colorError hover:underline max-md:-my-2 max-md:min-h-11 max-md:px-2"
                >
                    {t("chat.micPermissionNotice.dismiss")}
                </button>
            </div>
        </RevealCollapse>
    )
}

export default MicPermissionNotice
