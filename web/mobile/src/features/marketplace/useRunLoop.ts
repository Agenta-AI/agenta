import {useCallback, useEffect, useState} from "react"

import {useMotionPresets} from "@/lib/motion/presets"

type Phase = "reveal" | "hold" | "fade"

/** Loops an example run: steps, reply, hold, fade; still under reduced motion, paused when not playing. */
export const useRunLoop = (total: number, playing: boolean, loop = true) => {
    const {stepRevealMs, runHoldMs} = useMotionPresets()
    const still = !stepRevealMs
    const [beat, setBeat] = useState(0)
    const [phase, setPhase] = useState<Phase>("reveal")

    useEffect(() => {
        if (still || !playing) return
        if (phase === "reveal") {
            const timer = window.setTimeout(() => {
                if (beat >= total) setPhase("hold")
                setBeat((value) => Math.min(value + 1, total + 1))
            }, stepRevealMs)
            return () => window.clearTimeout(timer)
        }
        if (phase === "hold" && loop) {
            const timer = window.setTimeout(() => setPhase("fade"), runHoldMs)
            return () => window.clearTimeout(timer)
        }
    }, [beat, loop, phase, playing, runHoldMs, still, stepRevealMs, total])

    // Called when the body's fade-out finishes, so the restart follows the real animation.
    const onFaded = useCallback(() => {
        if (phase !== "fade") return
        setBeat(0)
        setPhase("reveal")
    }, [phase])

    return {revealed: still ? total + 1 : beat, fading: phase === "fade", onFaded}
}
