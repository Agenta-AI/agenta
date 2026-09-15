/** Row 2's type mark + file name, renamed in place (Enter / blur commit, Escape cancels). */
import {type KeyboardEvent, useEffect, useRef, useState} from "react"

import {nameOf} from "@agenta/entities/drive"
import {message} from "@agenta/ui/app-message"
import {Input} from "@agenta/ui/ui"

import {DriveTypeMark} from "./DriveTypeMark"

export const DriveInlineName = ({
    path,
    validate,
    onRename,
}: {
    path: string
    /** A reason the name can't be used, or null. */
    validate?: (name: string) => string | null
    /** Absent = read-only. */
    onRename?: (name: string) => Promise<boolean>
}) => {
    const name = nameOf(path)
    const [editing, setEditing] = useState(false)
    const [value, setValue] = useState(name)
    const [busy, setBusy] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    useEffect(() => {
        setEditing(false)
        setValue(name)
    }, [path, name])
    useEffect(() => {
        if (!editing) return
        const el = inputRef.current
        if (!el) return
        el.focus()
        // Select the stem, not the extension.
        const dot = name.lastIndexOf(".")
        el.setSelectionRange(0, dot > 0 ? dot : name.length)
    }, [editing, name])

    const cancel = () => {
        setEditing(false)
        setValue(name)
    }
    const commit = async () => {
        const next = value.trim()
        if (!onRename || busy) return
        if (next === name || !next) return cancel()
        const error = validate?.(next)
        if (error) {
            void message.error(error)
            inputRef.current?.focus()
            return
        }
        setBusy(true)
        const ok = await onRename(next)
        setBusy(false)
        if (ok) setEditing(false)
        else inputRef.current?.focus()
    }
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault()
            void commit()
        } else if (e.key === "Escape") {
            e.preventDefault()
            cancel()
        }
    }

    return (
        <span className="flex min-w-0 items-center gap-1.5 pl-1">
            <DriveTypeMark path={path} size="mini" />
            {editing ? (
                <Input
                    ref={inputRef}
                    size="sm"
                    value={value}
                    disabled={busy}
                    aria-label="File name"
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={onKeyDown}
                    onBlur={() => void commit()}
                    className="h-[22px] w-[240px] max-w-full px-1.5 text-[13px]"
                />
            ) : onRename ? (
                <button
                    type="button"
                    title="Rename"
                    onClick={() => setEditing(true)}
                    className="cursor-text truncate rounded border-0 bg-transparent px-1 py-0.5 text-[13px] font-medium text-colorText hover:bg-accent"
                >
                    {name}
                </button>
            ) : (
                <span className="truncate px-1 text-[13px] font-medium text-colorText" title={path}>
                    {name}
                </span>
            )}
        </span>
    )
}
