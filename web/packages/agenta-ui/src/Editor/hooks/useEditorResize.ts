import {useCallback, useEffect, useRef, useState} from "react"

import type {EditorProps} from "../types"

export function useEditorResize({
    singleLine,
    enableResize,
    boundWidth,
    boundHeight,
    skipHandle,
}: Pick<EditorProps, "singleLine" | "enableResize" | "boundWidth" | "boundHeight"> & {
    skipHandle?: boolean
}) {
    const containerRef = useRef<HTMLDivElement>(null)
    const isResizing = useRef(false)
    const [dimensions, setDimensions] = useState({width: 0, height: 0})
    const containerElmRef = useRef<HTMLDivElement | null>(null)

    // Use useCallback to prevent unnecessary re-renders and useRef to avoid state updates
    const setContainerElmCallback = useCallback((el: HTMLDivElement | null) => {
        containerElmRef.current = el
    }, [])

    useEffect(() => {
        if ((!containerRef.current && !containerElmRef.current) || singleLine || !enableResize) {
            return
        }

        const container = containerRef.current || containerElmRef.current
        if (!container) return
        const handle = container.querySelector(".resize-handle") as HTMLElement
        if (!skipHandle && !handle) {
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
            if (!isResizing.current || !container?.parentElement) return

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

        if (handle) {
            handle.addEventListener("mousedown", startResize)
            document.addEventListener("mousemove", throttledResize)
            document.addEventListener("mouseup", stopResize)
        }

        return () => {
            if (handle) {
                handle.removeEventListener("mousedown", startResize)
            }
            document.removeEventListener("mousemove", throttledResize)
            document.removeEventListener("mouseup", stopResize)
        }
    }, [skipHandle, singleLine, enableResize, boundWidth, boundHeight])

    return {containerRef, dimensions, setContainerElm: setContainerElmCallback}
}
