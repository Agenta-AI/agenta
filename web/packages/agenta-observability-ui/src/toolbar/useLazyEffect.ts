import {useEffect, useRef, type DependencyList, type EffectCallback} from "react"

/** Skips the effect on the initial render and runs only on dependency updates. */
export const useLazyEffect = (cb: EffectCallback, deps: DependencyList): void => {
    const initialized = useRef(false)

    useEffect(() => {
        if (!initialized.current) {
            initialized.current = true
            return
        }
        return cb()
    }, deps)
}
