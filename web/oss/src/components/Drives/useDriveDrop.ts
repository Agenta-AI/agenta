import {useCallback, useEffect, useRef, useState} from "react"

/**
 * Drag-and-drop upload behaviour shared by the drive's tree and grid: highlight the folder under
 * the cursor, spring-load into it after a short hover (drill to a nested destination without
 * dropping), and upload on drop — into the hovered folder, or the current folder for a background
 * drop. The views wire the returned handler props onto folder targets and their container.
 */

const SPRING_MS = 700

export const isFileDrag = (e: React.DragEvent): boolean =>
    Array.from(e.dataTransfer?.types ?? []).includes("Files")

export interface DriveDrop {
    /** A file drag is in progress anywhere over the drive (for a subtle drop-affordance). */
    dragging: boolean
    /** Folder path currently hovered as a drop target, or null. */
    hoverPath: string | null
    /** Handlers for a folder drop target — spring-loads into it, uploads on drop. */
    folderDropProps: (path: string) => {
        onDragEnter: (e: React.DragEvent) => void
        onDragOver: (e: React.DragEvent) => void
        onDrop: (e: React.DragEvent) => void
    }
    /** Handlers for the view container — clears the hover, uploads into `currentFolder` on drop. */
    containerDropProps: (currentFolder: string) => {
        onDragEnter: (e: React.DragEvent) => void
        onDragOver: (e: React.DragEvent) => void
        onDrop: (e: React.DragEvent) => void
    }
}

export function useDriveDrop({
    onUpload,
    onNavigate,
}: {
    onUpload: (files: File[], folder: string) => void
    onNavigate: (folder: string) => void
}): DriveDrop {
    const [dragging, setDragging] = useState(false)
    const [hoverPath, setHoverPath] = useState<string | null>(null)

    const springTimer = useRef<number | undefined>(undefined)
    const springPath = useRef<string | null>(null)
    const clearSpring = useCallback(() => {
        window.clearTimeout(springTimer.current)
        springTimer.current = undefined
        springPath.current = null
    }, [])

    // Window-level drag tracking for the overall `dragging` flag (depth counter absorbs the
    // dragenter/leave flicker from moving across child elements).
    const depth = useRef(0)
    useEffect(() => {
        const has = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files")
        const onEnter = (e: DragEvent) => {
            if (has(e)) {
                depth.current += 1
                setDragging(true)
            }
        }
        const onLeave = () => {
            depth.current = Math.max(0, depth.current - 1)
            if (depth.current === 0) setDragging(false)
        }
        const onEnd = () => {
            depth.current = 0
            setDragging(false)
            setHoverPath(null)
            clearSpring()
        }
        window.addEventListener("dragenter", onEnter)
        window.addEventListener("dragleave", onLeave)
        window.addEventListener("drop", onEnd)
        window.addEventListener("dragend", onEnd)
        return () => {
            window.removeEventListener("dragenter", onEnter)
            window.removeEventListener("dragleave", onLeave)
            window.removeEventListener("drop", onEnd)
            window.removeEventListener("dragend", onEnd)
        }
    }, [clearSpring])

    const startSpring = useCallback(
        (path: string) => {
            if (springPath.current === path) return // already counting down on this folder
            clearSpring()
            springPath.current = path
            springTimer.current = window.setTimeout(() => {
                onNavigate(path)
                clearSpring()
                setHoverPath(null)
            }, SPRING_MS)
        },
        [clearSpring, onNavigate],
    )

    const folderDropProps = useCallback(
        (path: string) => ({
            // Folder targets stop propagation, so the container's onDragEnter only fires over empty
            // space — which is how the hover clears when you move off a folder.
            onDragEnter: (e: React.DragEvent) => {
                if (!isFileDrag(e)) return
                e.preventDefault()
                e.stopPropagation()
                setHoverPath(path)
                startSpring(path)
            },
            onDragOver: (e: React.DragEvent) => {
                if (!isFileDrag(e)) return
                e.preventDefault()
                e.stopPropagation()
            },
            onDrop: (e: React.DragEvent) => {
                if (!isFileDrag(e)) return
                e.preventDefault()
                e.stopPropagation()
                const files = Array.from(e.dataTransfer.files)
                if (files.length) onUpload(files, path)
                setHoverPath(null)
                clearSpring()
            },
        }),
        [onUpload, startSpring, clearSpring],
    )

    const containerDropProps = useCallback(
        (currentFolder: string) => ({
            onDragEnter: (e: React.DragEvent) => {
                if (!isFileDrag(e)) return
                setHoverPath(null)
                clearSpring()
            },
            onDragOver: (e: React.DragEvent) => {
                if (isFileDrag(e)) e.preventDefault()
            },
            onDrop: (e: React.DragEvent) => {
                if (!isFileDrag(e)) return
                e.preventDefault()
                const files = Array.from(e.dataTransfer.files)
                if (files.length) onUpload(files, currentFolder)
                setHoverPath(null)
                clearSpring()
            },
        }),
        [onUpload, clearSpring],
    )

    return {dragging, hoverPath, folderDropProps, containerDropProps}
}
