/**
 * DriveMarkdownEditor — the Files pane's body for an editable `.md` / `.mdx`: the shared Lexical
 * {@link MarkdownEditor} (the instructions / skills editor) over the drive draft. Rendered mode is
 * the rich-text view with its formatting bar portalled into row 2; source mode is the monospace
 * markdown. Edits autosave; `Cmd/Ctrl+S` writes at once. The draft belongs to the explorer,
 * which also feeds row 2 — this component only renders it.
 *
 * Loaded lazily by the explorer so the Lexical graph arrives only when a markdown file opens.
 */
import {type KeyboardEvent, useCallback} from "react"

import {type DriveEditorMode} from "@agenta/entities/drive"
import {type Mount} from "@agenta/entities/session"
import {Skeleton} from "@agenta/ui/ui"

import {MarkdownEditor} from "../DrillInView/SchemaControls/MarkdownEditor"

import {DownloadCard} from "./renderers"

export interface DriveMarkdownEditorProps {
    mount: Mount | null
    path: string
    mode: DriveEditorMode
    /** Row 2's slot for the formatting bar. */
    toolbarContainer: HTMLElement | null
    value: string | null
    loading: boolean
    failed: boolean
    onChange: (text: string) => void
    onSave: () => void
}

export function DriveMarkdownEditor({
    mount,
    path,
    mode,
    toolbarContainer,
    value,
    loading,
    failed,
    onChange,
    onSave,
}: DriveMarkdownEditorProps) {
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
                <Skeleton className="h-6 w-2/3" />
                {Array.from({length: 6}).map((_, i) => (
                    <Skeleton key={i} className="h-4 w-full" />
                ))}
            </div>
        )
    return (
        // text-sm: the document prose reads at 14px here (the editor's paragraphs inherit).
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
