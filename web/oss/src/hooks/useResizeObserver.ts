import {useLayoutEffect, useRef} from "react"

const useResizeObserver = <T extends HTMLDivElement>(
    callback?: (entry: ResizeObserverEntry["contentRect"]) => void,
    element?: HTMLElement,
) => {
    const ref = useRef<T>(null)

    useLayoutEffect(() => {
        const _element = ref?.current || element

        if (!_element) {
            return
        }

        const observer = new ResizeObserver((entries) => {
            callback?.(entries[0].contentRect)
        })

        observer.observe(_element)
        return () => {
            observer.disconnect()
        }
    }, [callback, element, ref])

    return ref
}

export default useResizeObserver
