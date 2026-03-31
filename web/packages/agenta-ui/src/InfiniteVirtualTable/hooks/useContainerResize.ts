import {useEffect, useState} from "react"

interface ContainerSize {
    width: number
    height: number
}

/**
 * Hook to observe container dimensions using ResizeObserver with RAF throttling
 */
const useContainerResize = (
    containerRef: React.RefObject<HTMLDivElement | null>,
): ContainerSize => {
    const [containerSize, setContainerSize] = useState<ContainerSize>({
        width: 0,
        height: 0,
    })

    useEffect(() => {
        const element = containerRef.current
        if (!element) return

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

            const update = () => {
                setContainerSize((prev) => {
                    if (prev.width === nextWidth && prev.height === nextHeight) {
                        return prev
                    }
                    return {width: nextWidth, height: nextHeight}
                })
            }

            if (frameId !== null) {
                cancelAnimationFrame(frameId)
            }
            frameId = requestAnimationFrame(update)
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
