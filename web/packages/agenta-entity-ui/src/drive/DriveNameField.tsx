/**
 * The one name editor behind inline create and rename: mounts focused with the stem selected;
 * Enter or blur commits, Escape cancels; a rejected name toasts and keeps the field.
 */
import {type KeyboardEvent, useEffect, useRef, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {Input} from "@agenta/ui/ui"

/** The grid / list slot of an entry that does not exist yet. */
export const NEW_ENTRY_PATH = "__new__"

/** An entry being named in place in a folder view: a new one (`path` null, shown first) or an
 * existing one. */
export interface DriveNameEdit extends Omit<DriveNameFieldProps, "className"> {
    path: string | null
    kind: "folder" | "file"
}

export interface DriveNameFieldProps {
    initial: string
    /** A reason the name can't be used, or null. */
    validate: (name: string) => string | null
    /** Resolves true once the name landed; false keeps the field open. */
    onCommit: (name: string) => Promise<boolean>
    onCancel: () => void
    className?: string
}

export const DriveNameField = ({
    initial,
    validate,
    onCommit,
    onCancel,
    className,
}: DriveNameFieldProps) => {
    const [value, setValue] = useState(initial)
    const [busy, setBusy] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    // Blur after Escape or Enter must not commit a second time.
    const doneRef = useRef(false)

    useEffect(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        const dot = initial.lastIndexOf(".")
        el.setSelectionRange(0, dot > 0 ? dot : initial.length)
    }, [initial])

    const cancel = () => {
        doneRef.current = true
        onCancel()
    }
    const commit = async () => {
        if (doneRef.current || busy) return
        const next = value.trim()
        if (!next || next === initial) return cancel()
        const error = validate(next)
        if (error) {
            void message.error(error)
            inputRef.current?.focus()
            return
        }
        setBusy(true)
        const ok = await onCommit(next)
        setBusy(false)
        if (ok) doneRef.current = true
        else inputRef.current?.focus()
    }
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        // Nothing here is the pane's business (its ⌫ / Esc chords stop at a field anyway).
        e.stopPropagation()
        if (e.key === "Enter") {
            e.preventDefault()
            void commit()
        } else if (e.key === "Escape") {
            e.preventDefault()
            cancel()
        }
    }

    return (
        <Input
            ref={inputRef}
            size="sm"
            value={value}
            disabled={busy}
            aria-label="Name"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => void commit()}
            onClick={(e) => e.stopPropagation()}
            className={className}
        />
    )
}
