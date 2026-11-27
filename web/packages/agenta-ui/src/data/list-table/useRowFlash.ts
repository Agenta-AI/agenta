import {useEffect, useState} from "react"

type FlashPhase = "on" | "fade"

/** How long the fill holds before it fades, and how long the fade (`--duration-slow`) runs. */
const HOLD_MS = 1200
const FADE_MS = 320

/** Flashes the given keys once: a `selected` fill, held, then faded out at `--duration-slow`. */
export const useRowFlash = (keys: ReadonlySet<string> | undefined) => {
    const [flash, setFlash] = useState<{keys: ReadonlySet<string>; phase: FlashPhase} | null>(null)
    useEffect(() => {
        if (!keys?.size) return
        setFlash({keys, phase: "on"})
        const fade = setTimeout(() => setFlash({keys, phase: "fade"}), HOLD_MS)
        const done = setTimeout(() => setFlash(null), HOLD_MS + FADE_MS)
        return () => {
            clearTimeout(fade)
            clearTimeout(done)
        }
    }, [keys])

    return (key: string): string | undefined => {
        if (!flash?.keys.has(key)) return undefined
        return flash.phase === "on"
            ? "bg-selected"
            : "transition-colors duration-[var(--duration-slow)] ease-out motion-reduce:transition-none"
    }
}
