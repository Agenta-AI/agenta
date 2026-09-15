/**
 * DriveCodeEditor — the Files pane's body for an editable code / text file: the shared
 * {@link SharedEditor} in code mode (the testcase / preset YAML-JSON editor) over the drive draft,
 * with the kit's Prism / Shiki highlighting. Edits autosave; `Cmd/Ctrl+S` writes at once. The
 * draft belongs to the explorer, which also feeds row 2 — this component only renders it.
 *
 * Loaded lazily by the explorer so the Lexical graph arrives only when such a file opens.
 */
import {type KeyboardEvent, useCallback} from "react"

import {driveCodeLanguage} from "@agenta/entities/drive"
import {type Mount} from "@agenta/entities/session"
import {type CodeLanguage, EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {Skeleton} from "@agenta/ui/ui"

import {DownloadCard} from "./renderers"

/** The kit editor's grammar for a file: its own for the languages it tokenizes, generic otherwise. */
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

export interface DriveCodeEditorProps {
    mount: Mount | null
    path: string
    value: string | null
    loading: boolean
    failed: boolean
    onChange: (text: string) => void
    onSave: () => void
}

export function DriveCodeEditor({
    mount,
    path,
    value,
    loading,
    failed,
    onChange,
    onSave,
}: DriveCodeEditorProps) {
    const onKeyDown = useCallback(
        (e: KeyboardEvent<HTMLDivElement>) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                e.preventDefault()
                onSave()
            }
        },
        [onSave],
    )
    if (failed)
        return (
            <div className="flex min-h-0 flex-1 flex-col p-4">
                <DownloadCard mount={mount} path={path} title="Couldn't load this file's content" />
            </div>
        )
    if (loading || value === null)
        return (
            <div className="flex flex-col gap-2 p-5">
                {Array.from({length: 8}).map((_, i) => (
                    <Skeleton key={i} className="h-4 w-full" />
                ))}
            </div>
        )
    const language = editorLanguage(path)
    // Keyed by mount + path: a different file is a different editor, never a re-seeded one.
    const editorId = `drive-code-${mount?.id ?? ""}-${path}`
    return (
        <div
            className="flex min-h-0 flex-1 flex-col overflow-auto p-2 text-xs [&_.editor-code]:!bg-transparent [&_.editor-container]:!bg-transparent [&_.editor-inner]:!border-0 [&_.editor-inner]:!bg-transparent"
            onKeyDown={onKeyDown}
        >
            <EditorProvider
                key={editorId}
                id={editorId}
                initialValue={value}
                showToolbar={false}
                codeOnly
                language={language}
            >
                <SharedEditor
                    id={editorId}
                    initialValue={value}
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
