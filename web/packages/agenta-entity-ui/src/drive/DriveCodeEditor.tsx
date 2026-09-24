/** The Files pane's body for an editable code / text file: the kit's code editor over the draft. */
import {useRef} from "react"

import {driveCodeLanguage, useDriveFileDraft} from "@agenta/entities/drive"
import {type Mount} from "@agenta/entities/session"
import {type CodeLanguage, EditorProvider} from "@agenta/ui/editor"
import {QuoteSelectionLayer} from "@agenta/ui/quote-selection"
import {SharedEditor} from "@agenta/ui/shared-editor"

import {DriveEditorPlaceholder, useDriveSaveKey} from "./DriveEditorFrame"
import {useDriveSessionId} from "./driveSessionContext"
import {useQuotableFile} from "./quotable"

/** The kit editor's grammar for a file; generic for languages it doesn't tokenize. */
const editorLanguage = (path: string): CodeLanguage => {
    switch (driveCodeLanguage(path)) {
        case "json":
            return "json"
        case "yaml":
            return "yaml"
        case "python":
            return "python"
        case "javascript":
        case "jsx":
            return "javascript"
        case "typescript":
        case "tsx":
            return "typescript"
        default:
            return "code"
    }
}

interface DriveCodeEditorProps {
    mount: Mount | null
    path: string
    loading: boolean
    failed: boolean
    onSave: () => void
    /** The presented path (agent-files/ prefix) a quote names. Defaults to `path`. */
    displayPath?: string
}

export function DriveCodeEditor({
    mount,
    path,
    loading,
    failed,
    onSave,
    displayPath,
}: DriveCodeEditorProps) {
    // Mounted on the seed only: `initialValue` per keystroke would re-read the whole document.
    const {seed, value, onChange} = useDriveFileDraft(mount, path)
    const onKeyDown = useDriveSaveKey(onSave)
    // Quote-to-reply reads the live draft, so a quote's line range matches what is on screen.
    const quoteRootRef = useRef<HTMLDivElement>(null)
    const quoteSessionId = useDriveSessionId()
    const quotable = useQuotableFile(path, displayPath, value ?? seed ?? undefined)
    if (failed || loading || seed === null)
        return <DriveEditorPlaceholder mount={mount} path={path} failed={failed} lines={8} />
    const language = editorLanguage(path)
    const editorId = `drive-code-${mount?.id ?? ""}-${path}`
    return (
        // Every kit wrapper takes the column's height; the <code> element is the scroller.
        <div
            ref={quoteRootRef}
            className={[
                "relative flex min-h-0 flex-1 flex-col overflow-hidden text-xs",
                "[&_.agenta-rich-text-editor]:h-full [&_.agenta-shared-editor]:h-full [&_.agenta-shared-editor]:!min-h-0 [&_.agenta-shared-editor]:!border-0 [&_.agenta-shared-editor]:!rounded-none [&_.agenta-shared-editor]:!p-0",
                "[&_.agenta-editor-wrapper]:h-full [&_.editor-container]:h-full [&_.editor-container]:!overflow-visible",
                "[&_.editor-inner]:h-full [&_.editor-input]:h-full [&_.editor-code]:h-full [&_.editor-code]:!overflow-auto [&_.editor-code]:!p-2",
                "[&_.editor-code]:!bg-transparent [&_.editor-container]:!bg-transparent [&_.editor-inner]:!border-0 [&_.editor-inner]:!bg-transparent",
            ].join(" ")}
            onKeyDown={onKeyDown}
            {...quotable}
        >
            <QuoteSelectionLayer rootRef={quoteRootRef} sessionId={quoteSessionId} />
            <EditorProvider
                key={editorId}
                id={editorId}
                initialValue={seed}
                showToolbar={false}
                codeOnly
                language={language}
            >
                <SharedEditor
                    id={editorId}
                    initialValue={seed}
                    handleChange={onChange}
                    editorType="borderless"
                    disableDebounce
                    noProvider
                    editorProps={{
                        codeOnly: true,
                        language,
                        showLineNumbers: true,
                        disableLongText: true,
                    }}
                />
            </EditorProvider>
        </div>
    )
}
