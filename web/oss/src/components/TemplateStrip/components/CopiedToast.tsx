import {useEffect, useState} from "react"

import {Check} from "lucide-react"
import {createPortal} from "react-dom"

import {TOAST_DISMISS_MS} from "../assets/constants"

/**
 * Bottom-center confirmation toast for the coding-agent copy action. Custom (not AntD
 * message) so the designed dark pill doesn't require restyling messages globally.
 * Auto-dismisses; never steals focus.
 */
const CopiedToast = ({open, text, onDone}: {open: boolean; text: string; onDone: () => void}) => {
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        if (!open) return
        setVisible(true)
        const fade = setTimeout(() => setVisible(false), TOAST_DISMISS_MS - 200)
        const done = setTimeout(onDone, TOAST_DISMISS_MS)
        return () => {
            clearTimeout(fade)
            clearTimeout(done)
        }
    }, [open, onDone])

    if (!open || typeof document === "undefined") return null

    return createPortal(
        <div
            role="status"
            aria-live="polite"
            className={`fixed bottom-[26px] left-1/2 z-[1100] flex -translate-x-1/2 items-center gap-[9px] rounded-[9px] bg-[var(--ag-colorBgSpotlight)] px-[18px] py-[11px] text-[13.5px] text-white shadow-[0_10px_26px_rgba(5,23,41,0.35)] transition-opacity duration-200 ${
                visible ? "opacity-100" : "opacity-0"
            }`}
        >
            <Check size={15} strokeWidth={2.4} className="shrink-0 text-[var(--ant-lime-6)]" />
            {text}
        </div>,
        document.body,
    )
}

export default CopiedToast
