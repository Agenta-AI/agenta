/**
 * The control for a `list` step — an array the schema left open, with nothing to offer as rows.
 *
 * Chips rather than a comma-separated field: the separator was invisible until you got it wrong,
 * and a value containing a comma had no way in at all. Entries are committed one at a time, so what
 * the agent receives is exactly what the user saw.
 */
import {useEffect, useRef, useState} from "react"

import {useT} from "@agenta/i18n"
import chatElicitationCatalog from "@agenta/i18n/catalogs/chat.elicitation"
import {Badge} from "@agenta/ui/ui"
import {X} from "@phosphor-icons/react"

export interface ElicitationChipsProps {
    value: unknown
    label: string
    /** Suppress the keyboard affordance on a surface that has no keyboard. */
    touch?: boolean
    inputRef: React.Ref<HTMLInputElement>
    onChange: (value: string[]) => void
}

/** Tolerates the comma string a draft written before chips existed still holds. */
const chipsOf = (value: unknown): string[] => {
    if (Array.isArray(value))
        return value.filter((item): item is string => typeof item === "string")
    if (typeof value !== "string") return []
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
}

export const ElicitationChips = ({
    value,
    label,
    touch,
    inputRef,
    onChange,
}: ElicitationChipsProps) => {
    const t = useT(chatElicitationCatalog)
    const [draft, setDraft] = useState("")
    // The entry a duplicate press pointed at. Without this the keystroke does nothing visible at
    // all — no chip, no advance, no message — and reads as a dead field.
    const [dupe, setDupe] = useState<string | null>(null)
    const chips = chipsOf(value)
    const boxRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!dupe) return
        const timer = setTimeout(() => setDupe(null), 900)
        return () => clearTimeout(timer)
    }, [dupe])

    const commit = (text: string): boolean => {
        const entry = text.trim()
        if (!entry) return false
        // A duplicate keeps the draft — clearing it reads as the field eating keystrokes — and
        // points at the chip that already holds it.
        if (chips.includes(entry)) {
            setDupe(entry)
            return false
        }
        setDraft("")
        onChange([...chips, entry])
        return true
    }

    const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
            // Cmd/Ctrl+Enter leaves the step, and the card handles it; plain Enter only ever adds
            // an entry here.
            if (event.metaKey || event.ctrlKey) return
            event.preventDefault()
            commit(draft)
            return
        }
        if (event.key === ",") {
            event.preventDefault()
            commit(draft)
            return
        }
        if (event.key === "Backspace" && draft === "" && chips.length) {
            event.preventDefault()
            onChange(chips.slice(0, -1))
        }
    }

    return (
        <div
            ref={boxRef}
            onClick={() => boxRef.current?.querySelector("input")?.focus({preventScroll: true})}
            className="flex min-h-8 w-full cursor-text flex-wrap items-center gap-1 rounded-md border border-solid border-border bg-background px-2 py-1 focus-ring-field"
        >
            {chips.map((chip) => (
                <Badge
                    key={chip}
                    variant="default"
                    className={`gap-1 pr-1 transition-colors ${
                        dupe === chip ? "bg-warning/10 text-warning" : ""
                    }`}
                >
                    <span className="truncate">{chip}</span>
                    <button
                        type="button"
                        aria-label={t("chat.elicitation.removeChip", {chip})}
                        onClick={(event) => {
                            event.stopPropagation()
                            onChange(chips.filter((item) => item !== chip))
                        }}
                        className="flex cursor-pointer items-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
                    >
                        <X size={9} />
                    </button>
                </Badge>
            ))}
            <input
                ref={inputRef}
                aria-label={label}
                value={draft}
                placeholder={chips.length ? "" : t("chat.elicitation.addOne")}
                onKeyDown={onKeyDown}
                onChange={(event) => setDraft(event.target.value)}
                // A typed word left behind on blur reads as data loss, so commit it.
                onBlur={() => commit(draft)}
                className="min-w-20 flex-1 border-none bg-transparent text-label text-foreground outline-none placeholder:text-muted-foreground"
            />
            {/* The commit key sits at the field's edge, where the option rows put theirs, rather
                than inside the placeholder where it read as part of the prompt. */}
            {touch ? null : (
                <kbd
                    aria-hidden
                    className="ml-auto shrink-0 pr-0.5 font-sans text-caption text-muted-foreground"
                >
                    ↵
                </kbd>
            )}
        </div>
    )
}
