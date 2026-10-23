// Comment mode for the Files pane preview: the toolbar toggles it, the preview bodies read it.
import {createContext, useContext, useEffect, useMemo, useState, type ReactNode} from "react"

import type {DriveFileKind} from "@agenta/entities/drive"
import type {PreviewCommentTarget} from "@agenta/ui/quote-selection"

import {useDriveSessionId} from "./driveSessionContext"

interface PreviewCommentMode {
    enabled: boolean
    setEnabled: (enabled: boolean) => void
    /** Only the Files pane comments; the same bodies in the chat media viewer do not. */
    inPane: boolean
}

const PreviewCommentModeContext = createContext<PreviewCommentMode>({
    enabled: false,
    setEnabled: () => {},
    inPane: false,
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
    const value = useMemo(() => ({enabled, setEnabled, inPane: true}), [enabled])
    return (
        <PreviewCommentModeContext.Provider value={value}>
            {children}
        </PreviewCommentModeContext.Provider>
    )
}

export const usePreviewCommentMode = (): PreviewCommentMode => useContext(PreviewCommentModeContext)

/** The conversation comments go to; null outside the Files pane or a conversation. */
export const usePreviewCommentSession = (): string | null => {
    const sessionId = useDriveSessionId()
    return useContext(PreviewCommentModeContext).inPane ? sessionId : null
}

/** Who a preview comment belongs to: the file, as the agent and the pins see it. */
export const previewTarget = (
    path: string,
    displayPath?: string,
    mountId?: string,
): PreviewCommentTarget => ({
    path,
    displayPath: displayPath ?? path,
    fileName: path.split("/").pop() ?? path,
    mountId,
})
