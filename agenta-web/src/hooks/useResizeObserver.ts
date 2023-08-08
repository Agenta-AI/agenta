import {useLayoutEffect, useRef} from "react"

function useResizeObserver<T extends HTMLDivElement>(
    callback: (entry: ResizeObserverEntry["contentRect"]) => void,
) {
    const ref = useRef<T>(null)

    useLayoutEffect(() => {
        const element = ref?.current

        if (!element) {
            return
        }

        const observer = new ResizeObserver((entries) => {
            callback(entries[0].contentRect)
        })

        observer.observe(element)
        return () => {
            observer.disconnect()
        }
    }, [callback, ref])

    return ref
}

export default useResizeObserver
