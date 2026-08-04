import {useCallback} from "react"

import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {useAtomValue, useSetAtom} from "jotai"

import Markdown from "@/oss/components/AgentChatSlice/assets/markdown"

import {driveEditBufferAtom, markTeardownWarnedAtom, setEditDraftAtom} from "../state"

export function DriveFileEditor() {
    const buffer = useAtomValue(driveEditBufferAtom)
    const setDraft = useSetAtom(setEditDraftAtom)
    const markTeardownWarned = useSetAtom(markTeardownWarnedAtom)
    const handleChange = useCallback(
        (draft: string) => {
            setDraft(draft)
            if (
                buffer?.scope === "session" &&
                !buffer.teardownWarned &&
                draft !== buffer.original
            ) {
                markTeardownWarned()
            }
        },
        [buffer, markTeardownWarned, setDraft],
    )

    if (!buffer) return null

    const saving = buffer.saveStatus === "saving"
    const editorId = `drive-edit-${buffer.bufferId}`
    const previewing = buffer.mode === "markdown" && buffer.editorView === "preview"

    return (
        <div
            data-drive-edit-buffer={buffer.bufferId}
            className="relative flex min-h-0 flex-1 overflow-hidden rounded-md bg-colorBgContainer"
        >
            <EditorProvider
                codeOnly
                language={buffer.language}
                enableTokens={false}
                showToolbar={false}
                disabled={saving}
                id={editorId}
                className="!h-full !min-h-0 !rounded-none"
            >
                <SharedEditor
                    id={editorId}
                    editorType="borderless"
                    state={saving ? "readOnly" : "filled"}
                    disabled={saving}
                    initialValue={buffer.original}
                    value={buffer.draft}
                    handleChange={handleChange}
                    disableDebounce
                    noProvider
                    autoFocus
                    editorProps={{
                        codeOnly: true,
                        language: buffer.language,
                        noProvider: true,
                        showToolbar: false,
                        enableTokens: false,
                    }}
                    className={`!h-full !w-full !rounded-none !border-0 ${previewing ? "hidden" : ""}`}
                />
            </EditorProvider>
            {previewing ? (
                <div className="absolute inset-0 overflow-y-auto p-3">
                    <Markdown content={buffer.draft} className="!text-xs" />
                </div>
            ) : null}
        </div>
    )
}
