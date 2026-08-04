import {useCallback} from "react"

import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {useAtomValue, useSetAtom} from "jotai"

import Markdown from "@/oss/components/AgentChatSlice/assets/markdown"

import {ownedEditBufferAtomFamily, setEditDraftAtom, showTeardownNoticeAtom} from "../state"

export function DriveFileEditor({driveKey}: {driveKey: string}) {
    const buffer = useAtomValue(ownedEditBufferAtomFamily(driveKey))
    const setDraft = useSetAtom(setEditDraftAtom)
    const showTeardownNotice = useSetAtom(showTeardownNoticeAtom)
    const handleChange = useCallback(
        (draft: string) => {
            setDraft({driveKey, draft})
            if (
                buffer?.scope === "session" &&
                !buffer.showTeardownNotice &&
                draft !== buffer.original
            ) {
                showTeardownNotice(driveKey)
            }
        },
        [buffer, driveKey, setDraft, showTeardownNotice],
    )

    if (!buffer) return null

    const disabled = buffer.saveStatus === "saving" || buffer.reloading
    const editorId = `drive-edit-${buffer.bufferId}`
    const previewing = buffer.supportsMarkdownPreview && buffer.editorView === "preview"

    return (
        <div
            data-drive-edit-buffer={buffer.bufferId}
            className="relative flex min-h-0 flex-1 overflow-hidden rounded-md bg-colorBgContainer"
        >
            <EditorProvider
                codeOnly
                useNativeCodeNodes
                language={buffer.language}
                enableTokens={false}
                showToolbar={false}
                disabled={disabled}
                id={editorId}
                className="!h-full !min-h-0 !rounded-none"
            >
                <SharedEditor
                    id={editorId}
                    editorType="borderless"
                    state={disabled ? "readOnly" : "filled"}
                    disabled={disabled}
                    initialValue={buffer.original}
                    value={buffer.draft}
                    handleChange={handleChange}
                    disableDebounce
                    noProvider
                    autoFocus
                    editorProps={{
                        codeOnly: true,
                        useNativeCodeNodes: true,
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
