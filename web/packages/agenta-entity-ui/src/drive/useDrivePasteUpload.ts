/**
 * ⌘V / Ctrl+V into the Files pane uploads the clipboard's files (a screenshot, a picture copied
 * from a page, a file copied in Finder) to the current folder. The paste event lands on whatever
 * is focused, and a click on the pane's blank space focuses nothing, so the listener sits on the
 * document and asks two things: is the pane the user's current surface (the most recent press or
 * focus move landed on it), and is the target NOT a text field (the composer and the rename field
 * keep their own paste). A text-only paste is left alone either way.
 */
import {type RefObject, useEffect} from "react"

import {type DroppedFile, isEditableTarget, readPastedFiles} from "@agenta/entities/drive"

export function useDrivePasteUpload({
    paneRef,
    enabled,
    onFiles,
    isNameTaken,
}: {
    paneRef: RefObject<HTMLElement | null>
    enabled: boolean
    /** Receives the pasted files; the caller picks the destination folder. */
    onFiles: (files: DroppedFile[]) => void
    /** Does the destination folder already hold this name? Keeps a generated name from overwriting. */
    isNameTaken?: (name: string) => boolean
}) {
    useEffect(() => {
        if (!enabled) return
        // Whether the pane is the current surface: the latest press or focus move, whichever came
        // last, decides — a click on a non-focusable spot elsewhere leaves stale focus in the pane.
        let current = false
        const track = (e: Event) => {
            const target = e.target as Element | null
            // A menu opened from the pane portals to <body>: focus moving into it changes nothing.
            if (e.type === "focusin" && target?.closest?.('[role="menu"]')) return
            current = Boolean(paneRef.current?.contains(target))
        }
        const onPaste = (e: ClipboardEvent) => {
            if (!paneRef.current || e.defaultPrevented || isEditableTarget(e.target)) return
            if (!current) return
            const files = readPastedFiles(e.clipboardData, new Date(), isNameTaken)
            if (!files.length) return
            e.preventDefault()
            onFiles(files)
        }
        document.addEventListener("pointerdown", track, true)
        document.addEventListener("focusin", track, true)
        document.addEventListener("paste", onPaste)
        return () => {
            document.removeEventListener("pointerdown", track, true)
            document.removeEventListener("focusin", track, true)
            document.removeEventListener("paste", onPaste)
        }
    }, [paneRef, enabled, onFiles, isNameTaken])
}
