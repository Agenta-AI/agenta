/**
 * SkillUploadZone
 *
 * The "drag and drop a skill folder, .zip, or .skill" affordance from the skills design. Reads a
 * dropped folder (via the entries API), dropped files, or a browsed selection, parses them into a
 * {@link ParsedSkill}, and hands it back to the host to merge into the skill draft.
 */
import {useCallback, useRef, useState} from "react"

import {cn} from "@agenta/ui/styles"
import {UploadSimple} from "@phosphor-icons/react"
import {Button, Spin} from "antd"

import {parseSkillFromDataTransfer, parseSkillFromFileList, type ParsedSkill} from "./skillUpload"

export interface SkillUploadZoneProps {
    onParsed: (skill: ParsedSkill) => void
    disabled?: boolean
}

export function SkillUploadZone({onParsed, disabled}: SkillUploadZoneProps) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [over, setOver] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const run = useCallback(
        async (parse: () => Promise<ParsedSkill>) => {
            setBusy(true)
            setError(null)
            try {
                const skill = await parse()
                onParsed(skill)
            } catch {
                setError("Couldn't read that — drop a skill folder, a .zip, or a .skill file.")
            } finally {
                setBusy(false)
            }
        },
        [onParsed],
    )

    return (
        <div
            onDragOver={(e) => {
                if (disabled) return
                e.preventDefault()
                setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
                if (disabled) return
                e.preventDefault()
                setOver(false)
                const dt = e.dataTransfer
                run(() => parseSkillFromDataTransfer(dt))
            }}
            className={cn(
                "flex flex-col items-center justify-center gap-2 rounded border border-dashed px-4 py-5 text-center transition-colors",
                "border-[var(--ag-c-D6DEE6,#d6dee6)]",
                over && "border-[var(--ag-c-586673,#586673)] bg-[var(--ag-c-F5F7FA,#f5f7fa)]",
                disabled && "opacity-60",
            )}
        >
            {busy ? (
                <Spin size="small" />
            ) : (
                <UploadSimple size={20} className="text-[var(--ag-c-586673,#586673)]" />
            )}
            <div className="text-xs text-[var(--ag-c-586673,#586673)]">
                Drag a skill folder, <span className="font-mono">.zip</span>, or{" "}
                <span className="font-mono">.skill</span> here
            </div>
            <Button onClick={() => inputRef.current?.click()} disabled={disabled || busy}>
                Browse files
            </Button>
            {error ? (
                <div className="text-xs text-[var(--ag-c-FF4D4F,#ff4d4f)]">{error}</div>
            ) : null}
            <input
                ref={inputRef}
                type="file"
                multiple
                accept=".zip,.skill,.md,text/markdown,text/plain"
                className="hidden"
                onChange={(e) => {
                    const list = e.target.files
                    if (list && list.length) run(() => parseSkillFromFileList(list))
                    e.target.value = ""
                }}
            />
        </div>
    )
}
