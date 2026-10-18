import {useEffect, useState} from "react"

import {animate} from "motion/react"

import {countUpEase} from "./presets"

/** `target`, counted up from zero over `durationMs`; 0 ms shows it at once. */
export const useCountUp = (target: number, durationMs: number): number => {
    const [value, setValue] = useState(durationMs > 0 ? 0 : target)
    useEffect(() => {
        if (durationMs <= 0) {
            setValue(target)
            return
        }
        const controls = animate(0, target, {
            duration: durationMs / 1000,
            ease: countUpEase,
            onUpdate: setValue,
        })
        return () => controls.stop()
    }, [target, durationMs])
    return value
}
