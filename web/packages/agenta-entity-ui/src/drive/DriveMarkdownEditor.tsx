/** The Files pane's body for an editable markdown / text file: the shared {@link MarkdownEditor} over the draft. */
import {useCallback, useEffect, useRef, useState} from "react"

import {QuoteSelectionLayer} from "@agenta/editor/quote-selection"
import {type DriveEditorMode, useDriveFileDraft} from "@agenta/entities/drive"
import {type Mount} from "@agenta/entities/session"

import {MarkdownEditor} from "../DrillInView/SchemaControls/MarkdownEditor"

import {DriveEditorPlaceholder, DriveEditorSkeleton, useDriveSaveKey} from "./DriveEditorFrame"
import {useDriveSessionId} from "./driveSessionContext"
import {useQuotableFile} from "./quotable"
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
    const {value, onChange: onDraftChange} = useDriveFileDraft(mount, path)
    // The rich view re-serialises the file when it loads or switches view. Only text that follows
    // the person's own input counts as an edit, so opening a file never saves it.
    const userInput = useRef(false)
    const markInput = useCallback(() => {
        userInput.current = true
    }, [])
    // A view switch re-serialises too: a click before it is not an edit.
    useEffect(() => {
        userInput.current = false
    }, [mode])
    const onChange = useCallback(
        (text: string) => {
            onDraftChange(text, userInput.current)
            userInput.current = false
        },
        [onDraftChange],
    )
    const onKeyDown = useDriveSaveKey(onSave)
    // A link to a neighbouring file opens it here; a web URL stays Lexical's (a new tab).
    const onLinkClick = useDriveLinkClick(displayPath ?? path, onNavigate, linkExists)
    // Lexical paints its default view before the requested one lands; keep the skeleton up until then.
    const [ready, setReady] = useState(false)
    const onViewApplied = useCallback(() => setReady(true), [])
    // Quote-to-reply reads the draft, so a quote's line range matches what is on screen.
    const quoteRootRef = useRef<HTMLDivElement>(null)
    const quoteSessionId = useDriveSessionId()
    const quotable = useQuotableFile(mount, path, displayPath, value ?? undefined)
    if (failed || loading || value === null)
        return <DriveEditorPlaceholder mount={mount} path={path} failed={failed} lines={7} />
    return (
        <>
            {ready ? null : <DriveEditorSkeleton lines={7} />}
            <div
                ref={quoteRootRef}
                className="relative flex min-h-0 flex-1 flex-col text-body"
                hidden={!ready}
                onKeyDown={onKeyDown}
                onBeforeInputCapture={markInput}
                onKeyDownCapture={markInput}
                onPasteCapture={markInput}
                onCutCapture={markInput}
                onDropCapture={markInput}
                // The formatting bar is portalled into row 2 but still bubbles here.
                onPointerDownCapture={markInput}
                {...quotable}
            >
                <QuoteSelectionLayer rootRef={quoteRootRef} sessionId={quoteSessionId} />
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
