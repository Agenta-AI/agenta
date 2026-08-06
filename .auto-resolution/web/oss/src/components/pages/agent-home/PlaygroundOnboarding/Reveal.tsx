import {useEffect, useState, type ReactNode} from "react"

/**
 * Fade + subtle rise on mount. Used across the playground-native onboarding surfaces so they enter
 * the view instead of snapping in. `motion-safe` so reduced-motion users get an instant swap (the
 * one pre-effect frame at opacity-0 is imperceptible). Wrap a block that mounts/swaps in.
 */
const Reveal = ({
    children,
    className = "",
    delay = 0,
    enabled = true,
}: {
    children: ReactNode
    className?: string
    delay?: number
    /** When false, render fully shown with no entrance — for repeat mounts that already
     * played it once (e.g. each additional chat session pane's composer). */
    enabled?: boolean
}) => {
    const [shown, setShown] = useState(!enabled)
    useEffect(() => {
        // `enabled` flipping false MUST still land on shown — if it flips while the entrance
        // timeout is pending, the cleanup cancels it and an early return would strand the
        // content at opacity-0 permanently.
        if (!enabled) {
            setShown(true)
            return
        }
        const id = window.setTimeout(() => setShown(true), delay)
        return () => window.clearTimeout(id)
    }, [delay, enabled])

    return (
        <div
            className={`motion-safe:transition-[opacity,transform] motion-safe:duration-300 motion-safe:ease-out ${
                shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
            } ${className}`}
        >
            {children}
        </div>
    )
}

export default Reveal
