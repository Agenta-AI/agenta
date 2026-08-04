import {Segmented, Tooltip} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {
    driveEditPreviewCapabilityAtomFamily,
    driveEditingAtomFamily,
    driveEditorLanguageAtomFamily,
    driveEditorViewAtomFamily,
    driveEditTeardownNoticeAtomFamily,
    setEditorViewAtom,
} from "../state"

const LANGUAGE_LABELS = {
    json: "JSON",
    yaml: "YAML",
    python: "Python",
    javascript: "JavaScript",
    typescript: "TypeScript",
    code: "Plain text",
} as const

export function DriveEditBar({driveKey}: {driveKey: string}) {
    const editing = useAtomValue(driveEditingAtomFamily(driveKey))
    const supportsMarkdownPreview = useAtomValue(driveEditPreviewCapabilityAtomFamily(driveKey))
    const editorView = useAtomValue(driveEditorViewAtomFamily(driveKey))
    const language = useAtomValue(driveEditorLanguageAtomFamily(driveKey))
    const showTeardownNotice = useAtomValue(driveEditTeardownNoticeAtomFamily(driveKey))
    const setEditorView = useSetAtom(setEditorViewAtom)

    if (!editing) return null

    return (
        <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-0 border-b border-solid border-colorBorderSecondary bg-colorBgContainer px-3 py-2 text-xs text-colorText">
            <div className="flex min-w-0 items-center gap-3">
                <span className="font-medium">Editing</span>
                <span className="h-4 w-px bg-colorBorderSecondary" aria-hidden />
            </div>
            {supportsMarkdownPreview ? (
                <Segmented
                    size="small"
                    value={editorView}
                    options={[
                        {label: "Source", value: "source"},
                        {label: "Preview", value: "preview"},
                    ]}
                    onChange={(value) =>
                        setEditorView({
                            driveKey,
                            editorView: value as "source" | "preview",
                        })
                    }
                />
            ) : (
                <Tooltip title="Syntax highlighting only">
                    <span className="rounded border border-solid border-colorBorderSecondary bg-colorFillQuaternary px-2 py-1 font-mono text-[11px] text-colorTextSecondary">
                        {LANGUAGE_LABELS[language]}
                    </span>
                </Tooltip>
            )}
            {showTeardownNotice ? (
                <span className="min-w-0 flex-1 truncate text-colorWarning">
                    Session files may be removed when this session ends.
                </span>
            ) : null}
            <span className="ml-auto shrink-0 text-colorTextTertiary">Esc to cancel</span>
        </div>
    )
}
