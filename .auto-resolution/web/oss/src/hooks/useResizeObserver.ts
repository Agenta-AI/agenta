import {useLayoutEffect, useRef} from "react"

const useResizeObserver = <T extends HTMLDivElement>(
    callback?: (entry: ResizeObserverEntry["contentRect"], element?: HTMLElement) => void,
    element?: HTMLElement,
    skip = false,
) => {
    const ref = useRef<T>(null)

    useLayoutEffect(() => {
        if (skip) return
        const _element = ref?.current || element

        if (!_element) {
            return
        }

        const observer = new ResizeObserver((entries) => {
            callback?.(entries[0].contentRect, _element)
        })

        observer.observe(_element)
        return () => {
            observer.disconnect()
        }
    }, [callback, element, ref, skip])

    return ref
}

export default useResizeObserver
