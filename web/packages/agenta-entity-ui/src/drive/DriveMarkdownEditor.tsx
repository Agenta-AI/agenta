/** The Files pane's body for an editable markdown file: the shared {@link MarkdownEditor} over the draft. */
import {type DriveEditorMode, useDriveFileDraft} from "@agenta/entities/drive"
import {type Mount} from "@agenta/entities/session"

import {MarkdownEditor} from "../DrillInView/SchemaControls/MarkdownEditor"

import {DriveEditorPlaceholder, useDriveSaveKey} from "./DriveEditorFrame"

interface DriveMarkdownEditorProps {
    mount: Mount | null
    path: string
    mode: DriveEditorMode
    /** Row 2's slot for the formatting bar. */
    toolbarContainer: HTMLElement | null
    loading: boolean
    failed: boolean
    onSave: () => void
}

export function DriveMarkdownEditor({
    mount,
    path,
    mode,
    toolbarContainer,
    loading,
    failed,
    onSave,
}: DriveMarkdownEditorProps) {
    const {value, onChange} = useDriveFileDraft(mount, path)
    const onKeyDown = useDriveSaveKey(onSave)
    if (failed || loading || value === null)
        return <DriveEditorPlaceholder mount={mount} path={path} failed={failed} lines={7} />
    return (
        <div className="flex min-h-0 flex-1 flex-col text-sm" onKeyDown={onKeyDown}>
            <MarkdownEditor
                value={value}
                onChange={onChange}
                view={mode}
                showToolbar
                toolbarContainer={toolbarContainer}
                toolbarLayout="inline"
                hideHeader
                bordered={false}
                grow
            />
        </div>
    )
}
