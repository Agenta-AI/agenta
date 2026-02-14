import {useRef, useEffect, type DependencyList} from "react"

type Callback = (...args: unknown[]) => void

/**
 * A custom hook that skips the effect on the initial render
 * and runs only on dependency updates, handling React Strict Mode behavior.
 */
const useLazyEffect = (cb: Callback, dep: DependencyList): void => {
    const initializeRef = useRef(false)

    useEffect((...args) => {
        if (initializeRef.current) {
            cb(args)
        } else {
            initializeRef.current = true
        }
    }, dep)
}

export default useLazyEffect
