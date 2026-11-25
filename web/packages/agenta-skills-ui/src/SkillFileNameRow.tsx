import {useEffect, useId, useRef, useState} from "react"

import {createT, useT} from "@agenta/i18n"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import {IconTile, Input} from "@agenta/ui/ui"
import {FileText} from "@phosphor-icons/react"

const tNow = createT(skillsEditorCatalog)

// Trims each part but keeps empty ones, so `a//b.md` is reported, not silently fixed.
const cleanPath = (raw: string) =>
    raw
        .split("/")
        .map((part) => part.trim())
        .join("/")

/** Why a path cannot be used, or null when it can. */
export const filePathProblem = (path: string, taken: ReadonlySet<string>): string | null => {
    if (!path) return tNow("skills.editor.nameFile")
    if (path.includes("\\")) return tNow("skills.editor.useSlash")
    const parts = path.split("/")
    if (!parts[parts.length - 1]) return tNow("skills.editor.nameFile")
    if (parts.some((part) => !part)) return tNow("skills.editor.useSlash")
    if (parts.some((part) => part === "." || part === ".."))
        return tNow("skills.editor.plainName")
    if (path.toLowerCase() === "skill.md") return tNow("skills.editor.skillMdReserved")
    if (path.length > 255) return tNow("skills.editor.shorterName")
    if (taken.has(path)) return tNow("skills.editor.fileExists")
    return null
}

/** One path field to name, rename or move a file. Enter or blur saves; Escape or an empty value cancels. */
export function SkillFileNameRow({
    initialPath = "",
    isNew,
    taken,
    onSubmit,
    onCancel,
}: {
    initialPath?: string
    isNew: boolean
    /** Paths already in use; the file being renamed is not in it. */
    taken: ReadonlySet<string>
    onSubmit: (path: string) => void
    onCancel: () => void
}) {
    const t = useT(skillsEditorCatalog)
    const [value, setValue] = useState(initialPath)
    const [error, setError] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const done = useRef(false)
    const errorId = useId()

    // A menu that opened this row may still hold focus on the first frame.
    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            const input = inputRef.current
            if (!input) return
            input.focus()
            const start = input.value.lastIndexOf("/") + 1
            const dot = input.value.lastIndexOf(".")
            input.setSelectionRange(start, dot > start ? dot : input.value.length)
        })
        return () => cancelAnimationFrame(frame)
    }, [])

    const finish = () => {
        if (done.current) return
        const path = cleanPath(value)
        if (!path || path === cleanPath(initialPath)) {
            done.current = true
            onCancel()
            return
        }
        const problem = filePathProblem(path, taken)
        if (problem) {
            // The row stays open with the error, so the typed name is kept.
            setError(problem)
            return
        }
        done.current = true
        onSubmit(path)
    }

    return (
        <div className="flex flex-col gap-1">
            <div className="flex min-h-row-single items-center gap-2 px-2 max-sm:min-h-11">
                <IconTile size={24} aria-hidden>
                    <FileText />
                </IconTile>
                <Input
                    ref={inputRef}
                    size="sm"
                    value={value}
                    onChange={(event) => {
                        setValue(event.target.value)
                        setError(null)
                    }}
                    onBlur={finish}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault()
                            finish()
                        } else if (event.key === "Escape") {
                            event.preventDefault()
                            done.current = true
                            onCancel()
                        }
                    }}
                    placeholder={t("skills.editor.filePathPlaceholder")}
                    aria-label={
                        isNew ? t("skills.editor.newFilePath") : t("skills.editor.filePath")
                    }
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    className="min-w-0 flex-1"
                />
            </div>
            {error ? (
                <span id={errorId} role="alert" className="pl-10 text-meta text-destructive">
                    {error}
                </span>
            ) : null}
        </div>
    )
}
