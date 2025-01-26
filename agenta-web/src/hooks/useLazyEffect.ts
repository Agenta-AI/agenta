import {useRef, useEffect, DependencyList} from "react"

type Callback = (...args: any[]) => void

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
            initializeRef.current = true // Mark as mounted
        }
    }, dep)
}

export default useLazyEffect
