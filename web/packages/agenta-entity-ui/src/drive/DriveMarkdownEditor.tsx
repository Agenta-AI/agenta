/** The Files pane's body for an editable markdown / text file: the shared {@link MarkdownEditor} over the draft. */
import {useCallback, useState} from "react"

import {type DriveEditorMode, useDriveFileDraft} from "@agenta/entities/drive"
import {type Mount} from "@agenta/entities/session"

import {MarkdownEditor} from "../DrillInView/SchemaControls/MarkdownEditor"

import {DriveEditorPlaceholder, DriveEditorSkeleton, useDriveSaveKey} from "./DriveEditorFrame"
import {useDriveLinkClick} from "./useDriveLinkClick"

interface DriveMarkdownEditorProps {
    mount: Mount | null
    path: string
    mode: DriveEditorMode
    /** Row 2's slot for the formatting bar. */
    toolbarContainer: HTMLElement | null
    loading: boolean
    failed: boolean
    onSave: () => void
    /** The presented path (agent-files/ prefix) a link inside resolves against. Defaults to `path`. */
    displayPath?: string
    /** Open a drive file a link names; absent → every link is the browser's. */
    onNavigate?: (path: string) => void
    /** Is this presented path in the tree already loaded? Picks between a link's readings. */
    linkExists?: (path: string) => boolean
}

export function DriveMarkdownEditor({
    mount,
    path,
    mode,
    toolbarContainer,
    loading,
    failed,
    onSave,
    displayPath,
    onNavigate,
    linkExists,
}: DriveMarkdownEditorProps) {
    const {value, onChange} = useDriveFileDraft(mount, path)
    const onKeyDown = useDriveSaveKey(onSave)
    // A link to a neighbouring file opens it here; a web URL stays Lexical's (a new tab).
    const onLinkClick = useDriveLinkClick(displayPath ?? path, onNavigate, linkExists)
    // Lexical paints its default view before the requested one lands; keep the skeleton up until then.
    const [ready, setReady] = useState(false)
    const onViewApplied = useCallback(() => setReady(true), [])
    if (failed || loading || value === null)
        return <DriveEditorPlaceholder mount={mount} path={path} failed={failed} lines={7} />
    return (
        <>
            {ready ? null : <DriveEditorSkeleton lines={7} />}
            <div
                className="flex min-h-0 flex-1 flex-col text-sm"
                hidden={!ready}
                onKeyDown={onKeyDown}
            >
                <MarkdownEditor
                    value={value}
                    onChange={onChange}
                    view={mode}
                    onViewApplied={onViewApplied}
                    showToolbar
                    toolbarContainer={toolbarContainer}
                    toolbarLayout="inline"
                    hideHeader
                    bordered={false}
                    grow
                    onLinkClick={onLinkClick}
                />
            </div>
        </>
    )
}
