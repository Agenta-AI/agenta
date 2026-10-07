import {useEffect, useState} from "react"

/** `target`, counted up from zero over `durationMs` on an ease-out cubic; 0 ms shows it at once. */
export const useCountUp = (target: number, durationMs: number): number => {
    const [value, setValue] = useState(durationMs > 0 ? 0 : target)
    useEffect(() => {
        if (durationMs <= 0) {
            setValue(target)
            return
        }
        let frame = 0
        const start = performance.now()
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / durationMs)
            setValue(target * (1 - Math.pow(1 - t, 3)))
            if (t < 1) frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frame)
    }, [target, durationMs])
    return value
}
