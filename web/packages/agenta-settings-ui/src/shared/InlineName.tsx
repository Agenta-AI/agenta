import {useEffect, useRef, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {Input, cn} from "@agenta/ui/ui"

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
    // Blur fires before a keydown's commit lands; one save per edit.
    const doneRef = useRef(false)

    useEffect(() => {
        if (!editing) return
        doneRef.current = false
        setDraft(value)
    }, [editing, value])

    const commit = async () => {
        if (doneRef.current) return
        doneRef.current = true
        const name = draft.trim()
        if (!name || name === value) return onDone()
        const problem = validate?.(name)
        if (problem) {
            message.error(problem)
            return onDone()
        }
        try {
            await onSave(name)
        } catch (error) {
            message.error((error as Error)?.message || "Couldn't rename this")
        }
        onDone()
    }

    if (editing)
        return (
            <span
                className="min-w-0 flex-1"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
            >
                <Input
                    autoFocus
                    aria-label={ariaLabel}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
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
