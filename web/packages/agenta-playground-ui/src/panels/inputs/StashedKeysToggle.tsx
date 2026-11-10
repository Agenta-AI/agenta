import {useState} from "react"

import {CollapseCaret} from "@agenta/ui/ui"

import type {StashedPath} from "../../utils/variableShape"

/** A short, read-only look at a stashed value: text as is, anything else as JSON cut to 80 characters. */
const previewValue = (value: unknown): string => {
    if (value === undefined) return "undefined"
    if (value === null) return "null"
    if (typeof value === "string") return value || '""'
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    const json = JSON.stringify(value)
    return json.length > 80 ? `${json.slice(0, 77)}…` : json
}

export interface StashedKeysToggleProps {
    variableName: string
    paths: StashedPath[]
}

/**
 * Nested keys that the test case holds but the prompt does not reference. Closed by default, and
 * the card remounts it with a new `key` when the set of paths changes, so a new key never appears
 * inside a list the user already opened.
 */
export const StashedKeysToggle = ({variableName, paths}: StashedKeysToggleProps) => {
    const [open, setOpen] = useState(false)
    if (paths.length === 0) return null

    const noun = `nested key${paths.length === 1 ? "" : "s"}`
    const summary = open
        ? `${paths.length} unused ${noun} (not referenced by the prompt)`
        : `${paths.length} unused ${noun} hidden because the prompt does not reference them.`

    return (
        <div className="flex min-w-0 flex-col gap-1">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((previous) => !previous)}
                className="flex items-center gap-1 self-start border-0 bg-transparent p-0 text-left text-xs text-muted-foreground"
            >
                <CollapseCaret open={open} />
                {summary}
            </button>
            {open ? (
                <ul className="m-0 flex list-none flex-col gap-1 border-0 border-l-2 border-solid border-border p-0 pl-2">
                    {paths.map((entry) => (
                        <li
                            key={entry.path}
                            className="flex min-w-0 items-baseline gap-2 py-0.5 text-xs"
                        >
                            <code className="shrink-0 font-mono text-primary">
                                {variableName}.{entry.path}
                            </code>
                            <span className="truncate font-mono text-muted-foreground">
                                {previewValue(entry.value)}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    )
}
