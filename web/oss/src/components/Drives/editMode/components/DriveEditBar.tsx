import {Segmented, Tooltip} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {driveEditBufferAtom, setEditorViewAtom} from "../state"

const LANGUAGE_LABELS = {
    json: "JSON",
    yaml: "YAML",
    python: "Python",
    javascript: "JavaScript",
    typescript: "TypeScript",
    code: "Plain text",
} as const

export function DriveEditBar() {
    const buffer = useAtomValue(driveEditBufferAtom)
    const setEditorView = useSetAtom(setEditorViewAtom)

    if (!buffer) return null

    return (
        <div className="flex min-h-11 shrink-0 items-center gap-3 border-0 border-b border-solid border-colorBorderSecondary bg-colorBgContainer px-3 py-2 text-xs text-colorText">
            <span className="font-medium">Editing</span>
            <span className="h-4 w-px bg-colorBorderSecondary" aria-hidden />
            {buffer.mode === "markdown" ? (
                <Segmented
                    size="small"
                    value={buffer.editorView}
                    options={[
                        {label: "Source", value: "source"},
                        {label: "Preview", value: "preview"},
                    ]}
                    onChange={(value) => setEditorView(value as "source" | "preview")}
                />
            ) : (
                <Tooltip title="Syntax highlighting only">
                    <span className="rounded border border-solid border-colorBorderSecondary bg-colorFillQuaternary px-2 py-1 font-mono text-[11px] text-colorTextSecondary">
                        {LANGUAGE_LABELS[buffer.language]}
                    </span>
                </Tooltip>
            )}
            {buffer.teardownWarned ? (
                <span className="text-colorWarning">
                    Session files may be removed when this session ends.
                </span>
            ) : null}
            <span className="ml-auto text-colorTextTertiary">
                Esc to cancel · filters resume after saving
            </span>
        </div>
    )
}
