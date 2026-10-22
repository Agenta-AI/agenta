// Comment mode for the Files pane preview: the toolbar toggles it, the preview bodies read it.
import {createContext, useContext, useEffect, useMemo, useState, type ReactNode} from "react"

import type {DriveFileKind} from "@agenta/entities/drive"

interface PreviewCommentMode {
    enabled: boolean
    setEnabled: (enabled: boolean) => void
}

const PreviewCommentModeContext = createContext<PreviewCommentMode>({
    enabled: false,
    setEnabled: () => {},
})

const COMMENTABLE_KINDS: ReadonlySet<DriveFileKind> = new Set([
    "html",
    "document",
    "presentation",
    "spreadsheet",
])

export const isCommentableKind = (kind: DriveFileKind | null | undefined): boolean =>
    !!kind && COMMENTABLE_KINDS.has(kind)

/** One per Files pane; a new `fileKey` turns the mode off. */
export function PreviewCommentModeProvider({
    fileKey,
    children,
}: {
    fileKey: string | null
    children: ReactNode
}) {
    const [enabled, setEnabled] = useState(false)
    useEffect(() => setEnabled(false), [fileKey])
    const value = useMemo(() => ({enabled, setEnabled}), [enabled])
    return (
        <PreviewCommentModeContext.Provider value={value}>
            {children}
        </PreviewCommentModeContext.Provider>
    )
}

export const usePreviewCommentMode = (): PreviewCommentMode =>
    useContext(PreviewCommentModeContext)
