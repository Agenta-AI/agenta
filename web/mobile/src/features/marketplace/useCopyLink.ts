import {useCallback, useEffect, useRef, useState} from "react"

const RESET_MS = 1600

/** Copies this page's URL; `copied` holds for a moment so the button can say so. */
export const useCopyLink = () => {
    const [copied, setCopied] = useState(false)
    const [supported, setSupported] = useState(false)
    const timer = useRef<number | undefined>(undefined)

    useEffect(() => {
        setSupported(Boolean(navigator.clipboard))
        return () => window.clearTimeout(timer.current)
    }, [])

    const copy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(window.location.href.split("#")[0])
        } catch {
            return
        }
        setCopied(true)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setCopied(false), RESET_MS)
    }, [])

    return {copied, copy, supported}
}
