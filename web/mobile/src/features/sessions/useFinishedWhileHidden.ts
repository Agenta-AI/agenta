import {useEffect, useRef, useState} from "react"

/** Not looking: the tab is hidden, or the window is behind another app. */
const away = () => document.hidden || !document.hasFocus()

/**
 * Did a run end while the user was away, and have they not come back since?
 *
 * The badge must not vanish the moment a background run finishes — that is when it is most
 * needed. The running→settled edge marks it (an error settle counts: it is worth seeing); coming
 * back clears it. "Back" is any evidence: the tab becoming visible, the window taking focus, or a
 * click or keypress in the page — the last two because an embedded webview can report the
 * document as hidden while the user is plainly looking at it, and the badge must not get stuck.
 */
export const useFinishedWhileHidden = (running: boolean): boolean => {
    const [unseen, setUnseen] = useState(false)
    const wasRunning = useRef(running)
    useEffect(() => {
        if (wasRunning.current && !running && away()) setUnseen(true)
        wasRunning.current = running
    }, [running])
    useEffect(() => {
        const seen = () => setUnseen(false)
        const onVisibility = () => {
            if (!document.hidden) seen()
        }
        document.addEventListener("visibilitychange", onVisibility)
        window.addEventListener("focus", seen)
        document.addEventListener("pointerdown", seen)
        document.addEventListener("keydown", seen)
        return () => {
            document.removeEventListener("visibilitychange", onVisibility)
            window.removeEventListener("focus", seen)
            document.removeEventListener("pointerdown", seen)
            document.removeEventListener("keydown", seen)
        }
    }, [])
    return unseen
}
