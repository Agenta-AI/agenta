import {useEffect, useRef, useState} from "react"

import {createT} from "@agenta/i18n"
import settingsSharedCatalog from "@agenta/i18n/catalogs/settings.shared"
import {Input, cn} from "@agenta/ui/ui"

const t = createT(settingsSharedCatalog)

/** A row name that becomes an input while renaming: Enter or blur saves, Escape cancels. */
export const InlineName = ({
    value,
    editing,
    ariaLabel,
    onStart,
    onDone,
    onSave,
    validate,
    className,
    testId,
}: {
    value: string
    editing: boolean
    ariaLabel: string
    onStart?: () => void
    /** Leaving the editor, saved or not. */
    onDone: () => void
    /** Persist the new name; throw to report a failure. */
    onSave: (name: string) => Promise<unknown>
    /** A reason the name cannot be used, shown instead of saving. */
    validate?: (name: string) => string | null
    className?: string
    testId?: string
}) => {
    const [draft, setDraft] = useState(value)
    const [problem, setProblem] = useState<string | null>(null)
    // Blur fires before a keydown's commit lands; one save per edit.
    const doneRef = useRef(false)

    useEffect(() => {
        if (!editing) return
        doneRef.current = false
        setDraft(value)
        setProblem(null)
    }, [editing, value])

    const commit = async () => {
        if (doneRef.current) return
        doneRef.current = true
        const name = draft.trim()
        if (!name || name === value) return onDone()
        // A refused name keeps the field open with the text, so the person can fix it.
        const refused = validate?.(name)
        if (refused) {
            setProblem(refused)
            doneRef.current = false
            return
        }
        try {
            await onSave(name)
        } catch (error) {
            setProblem((error as Error)?.message || t("settings.shared.renameFailed"))
            doneRef.current = false
            return
        }
        onDone()
    }

    if (editing)
        return (
            <span
                className="flex min-w-0 flex-1 flex-col gap-0.5"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
            >
                <Input
                    autoFocus
                    aria-label={ariaLabel}
                    value={draft}
                    aria-invalid={problem ? true : undefined}
                    onChange={(event) => {
                        setDraft(event.target.value)
                        setProblem(null)
                    }}
                    onBlur={() => void commit()}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") void commit()
                        if (event.key === "Escape") {
                            doneRef.current = true
                            onDone()
                        }
                    }}
                    className="h-7"
                />
                {problem ? (
                    <span role="alert" className="text-meta text-destructive">
                        {problem}
                    </span>
                ) : null}
            </span>
        )

    return (
        <span
            data-testid={testId}
            title={value}
            className={cn("truncate font-medium text-foreground", className)}
            onDoubleClick={
                onStart
                    ? (event) => {
                          event.stopPropagation()
                          onStart()
                      }
                    : undefined
            }
        >
            {value}
        </span>
    )
}
