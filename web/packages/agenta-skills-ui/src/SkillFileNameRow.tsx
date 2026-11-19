import {useEffect, useRef, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {cn} from "@agenta/ui/styles"
import {File as FileIcon} from "@phosphor-icons/react"

const cleanPath = (raw: string) =>
    raw
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean)
        .join("/")

/** Why a path cannot be used, or null when it can. */
export const filePathProblem = (path: string, taken: ReadonlySet<string>): string | null => {
    if (!path) return "Name the file."
    if (path.includes("\\")) return "Use / between folders."
    if (path.split("/").some((part) => part === "." || part === "..")) return "Use a plain name."
    if (path.toLowerCase() === "skill.md") return "SKILL.md holds the instructions."
    if (path.length > 255) return "Use a shorter name."
    if (taken.has(path)) return "A file with this name exists."
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
        if (!path || path === initialPath || path === cleanPath(initialPath)) {
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
            message.warning(`${isNew ? "File not added" : "File not renamed"}: ${problem}`)
        } else {
            setError(problem)
        }
    }

    return (
        <div className="flex animate-skill-enter flex-col gap-1">
            <div className="flex items-center gap-2.5 rounded-lg py-1.5 pl-2 pr-1.5">
                <span
                    aria-hidden
                    className="flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-muted text-muted-foreground"
                >
                    <FileIcon size={14} />
                </span>
                <input
                    ref={inputRef}
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
                    placeholder="folder/name.md"
                    aria-label={isNew ? "New file path" : "File path"}
                    aria-invalid={error ? true : undefined}
                    className={cn(
                        "-ml-1 h-7 min-w-0 flex-1 rounded-md border border-solid border-input bg-background px-1.5 font-[inherit] text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-placeholder focus:border-ring focus:ring-[3px] focus:ring-ring/30",
                        error &&
                            "border-destructive focus:border-destructive focus:ring-destructive/20",
                    )}
                />
            </div>
            {error ? (
                <span
                    role="alert"
                    className="animate-skill-enter pl-[46px] text-xs text-destructive"
                >
                    {error}
                </span>
            ) : null}
        </div>
    )
}
