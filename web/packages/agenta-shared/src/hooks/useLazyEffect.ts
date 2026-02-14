import {useRef, useEffect, type DependencyList} from "react"

/**
 * A custom hook that skips the effect on the initial render
 * and runs only on dependency updates, handling React Strict Mode behavior.
 */
const useLazyEffect = (cb: () => void, dep: DependencyList): void => {
    const initializeRef = useRef(false)

    useEffect(() => {
        if (initializeRef.current) {
            cb()
        } else {
            initializeRef.current = true
        }
    }, dep)
}

export default useLazyEffect
