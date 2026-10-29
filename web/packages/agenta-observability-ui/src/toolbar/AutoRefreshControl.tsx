import {useEffect, useState} from "react"

import {autoRefreshAtom} from "@agenta/observability"
import {Switch} from "@agenta/ui/ui"
import {useAtom} from "jotai"

import {AUTO_REFRESH_INTERVAL} from "./constants"

export interface AutoRefreshControlProps {
    /** Bumped by the host after every completed refresh; restarts the bar from zero. */
    resetTrigger?: number
    /** Must match the host's refresh interval or the bar drifts out of step with the reload. */
    intervalMs?: number
}

/**
 * The auto-refresh toggle plus the countdown bar under its label. The bar is a 100ms-ticked
 * width, not a CSS animation, so a mid-cycle refresh can snap it back to zero via `resetTrigger`.
 */
export const AutoRefreshControl = ({
    resetTrigger,
    intervalMs = AUTO_REFRESH_INTERVAL,
}: AutoRefreshControlProps) => {
    const [checked, onChange] = useAtom(autoRefreshAtom)
    const [progress, setProgress] = useState(0)
    const [key, setKey] = useState(0)

    // Reset animation when resetTrigger changes
    useEffect(() => {
        if (checked && resetTrigger !== undefined) {
            setProgress(0)
            setKey((prev) => prev + 1)
        }
    }, [resetTrigger, checked])

    useEffect(() => {
        if (!checked) {
            setProgress(0)
            return
        }

        // Start fresh animation
        setProgress(0)

        const startTime = Date.now()
        const interval = setInterval(() => {
            const elapsed = Date.now() - startTime
            const newProgress = Math.min((elapsed / intervalMs) * 100, 100)
            setProgress(newProgress)
        }, 100) // Update every 100ms for smooth animation

        return () => clearInterval(interval)
    }, [checked, key, intervalMs])

    return (
        <div className="ml-4 inline-flex items-center gap-2">
            <Switch
                size="sm"
                checked={checked}
                onCheckedChange={onChange}
                aria-label="Auto-refresh"
            />
            <div className="relative inline-block">
                <span className="text-[12px] text-colorTextSecondary">auto-refresh</span>
                {checked ? (
                    <div
                        className="absolute bottom-0 left-0 h-[2px] bg-colorTextSecondary transition-[width] duration-100"
                        style={{width: `${progress}%`}}
                    />
                ) : null}
            </div>
        </div>
    )
}

export default AutoRefreshControl
