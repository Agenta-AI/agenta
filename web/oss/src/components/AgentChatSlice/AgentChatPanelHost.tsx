import {useCallback, useEffect, useState} from "react"

import dynamic from "next/dynamic"

import AgentChatSkeleton from "./components/AgentChatSkeleton"

// No `loading` fallback here on purpose — the skeleton below is a persistent overlay,
// not a discarded placeholder, so the swap can be a crossfade instead of a replace.
// Once the module has loaded ONCE, later host mounts (navigate away and back) render the
// panel synchronously — the overlay must not re-arm, or every re-entry flashes a skeleton
// over content that is already available.
let agentChatPanelModuleLoaded = false
const AgentChatPanel = dynamic(
    () =>
        import("./AgentChatPanel").then((m) => {
            agentChatPanelModuleLoaded = true
            return m
        }),
    {ssr: false},
)

/**
 * Crossfade host for the lazy agent chat panel. On the FIRST load the skeleton stays
 * mounted while the heavy chunk loads AND while the real panel commits beneath it at
 * opacity 0; once the panel signals mounted, the skeleton dissolves and the panel fades
 * in — the components materialize through the skeleton in place, instead of a
 * discard → gap → sudden pop. On later mounts (module warm) the overlay is skipped
 * entirely and the panel paints in the first frame. The overlay never intercepts pointer
 * events, so the panel is interactive the moment it exists.
 */
const AgentChatPanelHost = ({entityId}: {entityId: string}) => {
    const [ready, setReady] = useState(() => agentChatPanelModuleLoaded)
    // Unmount the overlay only after the fade has played (timeout, not transitionend —
    // reduced-motion environments may never fire the event).
    const [overlayGone, setOverlayGone] = useState(() => agentChatPanelModuleLoaded)
    const onMounted = useCallback(() => setReady(true), [])
    useEffect(() => {
        if (!ready || overlayGone) return
        const t = window.setTimeout(() => setOverlayGone(true), 350)
        return () => window.clearTimeout(t)
    }, [ready, overlayGone])

    return (
        <div className="relative h-full min-h-0 w-full">
            <div
                className={`h-full min-h-0 w-full transition-opacity duration-300 ease-out ${
                    ready ? "opacity-100" : "opacity-0"
                }`}
            >
                <AgentChatPanel entityId={entityId} onMounted={onMounted} />
            </div>
            {overlayGone ? null : (
                <div
                    aria-hidden
                    className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ease-out ${
                        ready ? "opacity-0" : "opacity-100"
                    }`}
                >
                    <AgentChatSkeleton />
                </div>
            )}
        </div>
    )
}

export default AgentChatPanelHost
