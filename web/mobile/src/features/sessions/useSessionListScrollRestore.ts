import {useCallback, useLayoutEffect, useRef} from "react"

// Inner scrollers get no browser scroll restoration on back-navigation.
const savedPositions = new Map<string, number>()

/** Records the list scroller's position and restores it once per mount (when content is ready). */
export const useSessionListScrollRestore = (key: string, ready: boolean) => {
    const ref = useRef<HTMLDivElement | null>(null)
    const restoredRef = useRef(false)
    useLayoutEffect(() => {
        const el = ref.current
        if (!ready || restoredRef.current || !el) return
        el.scrollTop = savedPositions.get(key) ?? 0
        restoredRef.current = true
    }, [key, ready])
    const onScroll = useCallback(() => {
        const el = ref.current
        if (el) savedPositions.set(key, el.scrollTop)
    }, [key])
    return {ref, onScroll}
}
