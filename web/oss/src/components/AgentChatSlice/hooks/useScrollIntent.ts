import {useCallback, useRef, useState} from "react"

/**
 * Shared scroll INTENT for one conversation: the handful of refs that say what the transcript
 * should do next, owned in one place so the producers (send / queue release / history adoption)
 * and the engines (`useTranscriptScroll`, `useVirtuosoTranscript`) never have to know about each
 * other. They're refs, not state, so writing intent costs no render — which is why a send can
 * declare "glide to the bottom" mid-stream without touching the streaming hot path.
 *
 * Exactly three verbs, one per call-site shape:
 *  - `armGlide()` — SC-1 submit: park follow, arm ONE animated pin to the bottom.
 *  - `armJump()`  — SC-2 restore: arm ONE instant jump (adopted server history). Follow untouched.
 *  - `follow()`   — a send that leaves now (queue release / channelled run): stick from here.
 */
export const useScrollIntent = ({initialArmed}: {initialArmed: boolean}) => {
    // Stick to the bottom of the scrollable area. This is the ONE source of truth for auto-scroll:
    // the active turn reserves a viewport (min-h-full), so "bottom" puts the latest question at the
    // top with the answer streaming into the space below — the pin is emergent, not computed. A real
    // user scroll-up releases it (onScroll); jump-to-latest re-arms it.
    const stickRef = useRef(true)
    const [showJump, setShowJump] = useState(false)
    // Arm a one-shot scroll to the bottom: on a fresh submit (glide) and on restoring a saved thread
    // (instant). Combined with min-h-full this is the whole SC-1/SC-2 positioning — no per-element pin.
    const armBottomRef = useRef(initialArmed)
    const animateBottomRef = useRef(false)
    // Set while WE move the scroll (the bottom glide / SC-3 compensation). onScroll ignores the
    // resulting event so our own scroll isn't mistaken for the user reaching/leaving the live edge.
    const programmaticScrollRef = useRef(false)

    const armGlide = useCallback(() => {
        stickRef.current = false
        armBottomRef.current = true
        animateBottomRef.current = true
        setShowJump(false)
    }, [])

    const armJump = useCallback(() => {
        armBottomRef.current = true
    }, [])

    const follow = useCallback(() => {
        stickRef.current = true
        setShowJump(false)
    }, [])

    return {
        showJump,
        setShowJump,
        armGlide,
        armJump,
        follow,
        stickRef,
        armBottomRef,
        animateBottomRef,
        programmaticScrollRef,
    }
}

export type ScrollIntent = ReturnType<typeof useScrollIntent>
