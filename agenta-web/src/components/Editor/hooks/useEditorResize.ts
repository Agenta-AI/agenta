import {useEffect, useRef, useState} from "react"
import type {EditorProps} from "../types"

export function useEditorResize({
    singleLine,
    enableResize,
    boundWidth,
    boundHeight,
}: Pick<EditorProps, "singleLine" | "enableResize" | "boundWidth" | "boundHeight">) {
    const containerRef = useRef<HTMLDivElement>(null)
    const isResizing = useRef(false)
    const [dimensions, setDimensions] = useState({width: 0, height: 0})

    useEffect(() => {
        if (!containerRef.current || singleLine || !enableResize) {
            return
        }

        const container = containerRef.current
        const handle = container.querySelector(".resize-handle") as HTMLElement
        if (!handle) {
            return
        }

        const startResize = (e: MouseEvent) => {
            e.preventDefault()
            isResizing.current = true
        }

        const stopResize = () => {
            isResizing.current = false
        }

        const resize = (e: MouseEvent) => {
            if (!isResizing.current || !container.parentElement) return

            const parentRect = container.parentElement.getBoundingClientRect()
            let width = e.clientX - parentRect.left
            let height = e.clientY - parentRect.top

            if (boundWidth) {
                width = Math.max(200, Math.min(width, parentRect.width))
            } else {
                width = Math.max(200, width)
            }

            if (boundHeight) {
                height = Math.max(100, Math.min(height, parentRect.height))
            } else {
                height = Math.max(100, height)
            }

            setDimensions({width, height})
        }

        const throttledResize = (e: MouseEvent) => {
            requestAnimationFrame(() => resize(e))
        }

        handle.addEventListener("mousedown", startResize)
        document.addEventListener("mousemove", throttledResize)
        document.addEventListener("mouseup", stopResize)

        return () => {
            handle.removeEventListener("mousedown", startResize)
            document.removeEventListener("mousemove", throttledResize)
            document.removeEventListener("mouseup", stopResize)
        }
    }, [singleLine, enableResize, boundWidth, boundHeight, containerRef.current])

    return {containerRef, dimensions}
}
