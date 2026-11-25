import {useEffect, useRef, useState} from "react"

import {createT, useT} from "@agenta/i18n"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import {message} from "@agenta/ui/app-message"
import {IconTile, Input} from "@agenta/ui/ui"
import {File as FileIcon} from "@phosphor-icons/react"

const tNow = createT(skillsEditorCatalog)

const cleanPath = (raw: string) =>
    raw
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean)
        .join("/")

/** Why a path cannot be used, or null when it can. */
export const filePathProblem = (path: string, taken: ReadonlySet<string>): string | null => {
    if (!path) return tNow("skills.editor.nameFile")
    if (path.includes("\\")) return tNow("skills.editor.useSlash")
    if (path.split("/").some((part) => part === "." || part === ".."))
        return tNow("skills.editor.plainName")
    if (path.toLowerCase() === "skill.md") return tNow("skills.editor.skillMdReserved")
    if (path.length > 255) return tNow("skills.editor.shorterName")
    if (taken.has(path)) return tNow("skills.editor.fileExists")
    return null
}

/** One path field to name, rename or move a file. Enter or blur saves; Escape cancels. */
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

    const finish = (fromBlur: boolean) => {
        if (done.current) return
        const path = cleanPath(value)
        if (!path || path === cleanPath(initialPath)) {
            done.current = true
            onCancel()
            return
        }
        const problem = filePathProblem(path, taken)
        if (!problem) {
            done.current = true
            onSubmit(path)
        } else if (fromBlur) {
            done.current = true
            onCancel()
            message.warning(
                isNew
                    ? t("skills.editor.fileNotAdded", {problem})
                    : t("skills.editor.fileNotRenamed", {problem}),
            )
        } else {
            setError(problem)
        }
    }

    return (
        <div className="flex flex-col gap-1">
            <div className="flex h-row-single items-center gap-2 px-2">
                <IconTile size={24} aria-hidden>
                    <FileIcon />
                </IconTile>
                <Input
                    ref={inputRef}
                    size="sm"
                    value={value}
                    onChange={(event) => {
                        setValue(event.target.value)
                        setError(null)
                    }}
                    onBlur={() => finish(true)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault()
                            finish(false)
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
                    className="min-w-0 flex-1"
                />
            </div>
            {error ? (
                <span role="alert" className="pl-10 text-meta text-destructive">
                    {error}
                </span>
            ) : null}
        </div>
    )
}
