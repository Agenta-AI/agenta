import {useEffect, useLayoutEffect, useState} from "react"

interface ContainerSize {
    width: number
    height: number
}

// Measure before the browser paints on the client; fall back to useEffect on the
// server to avoid the SSR useLayoutEffect warning.
const useIsomorphicLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect

/**
 * Hook to observe container dimensions using ResizeObserver with RAF throttling.
 *
 * The initial size is measured synchronously in a layout effect so the first
 * painted frame already has the real container height. Without this, the size
 * starts at 0 and only updates a frame later (post-paint), which makes the
 * virtual table fall back to a ~360px viewport (see `useScrollConfig`) and
 * visibly grow to full height on every mount/navigation.
 */
const useContainerResize = (
    containerRef: React.RefObject<HTMLDivElement | null>,
): ContainerSize => {
    const [containerSize, setContainerSize] = useState<ContainerSize>({
        width: 0,
        height: 0,
    })

    useIsomorphicLayoutEffect(() => {
        const element = containerRef.current
        if (!element) return

        const applySize = (nextWidth: number, nextHeight: number) => {
            setContainerSize((prev) => {
                if (prev.width === nextWidth && prev.height === nextHeight) {
                    return prev
                }
                return {width: nextWidth, height: nextHeight}
            })
        }

        // Synchronous first measurement so the initial paint uses the real height
        // rather than 0 (and therefore the 360px scroll fallback).
        applySize(element.clientWidth, element.clientHeight)

        let frameId: number | null = null
        const observer = new ResizeObserver((entries) => {
            const entry = entries[0]
            if (!entry) return
            const contentBoxSize = Array.isArray(entry.contentBoxSize)
                ? entry.contentBoxSize[0]
                : entry.contentBoxSize
            const nextWidth =
                contentBoxSize?.inlineSize ?? entry.contentRect?.width ?? element.clientWidth
            const nextHeight =
                contentBoxSize?.blockSize ?? entry.contentRect?.height ?? element.clientHeight

            if (frameId !== null) {
                cancelAnimationFrame(frameId)
            }
            frameId = requestAnimationFrame(() => applySize(nextWidth, nextHeight))
        })

        observer.observe(element)
        return () => {
            if (frameId !== null) {
                cancelAnimationFrame(frameId)
            }
            observer.disconnect()
        }
    }, [containerRef])

    return containerSize
}

export default useContainerResize
