import {useState} from "react"

import {CollapseCaret} from "@agenta/ui/ui"

import {InputVariableCard} from "./InputVariableCard"

export interface UnusedColumnsToggleProps {
    rowId: string
    columns: {name: string; value: unknown}[]
}

/**
 * Test case columns the prompt does not reference, below the input cards of a row. Closed by
 * default; the list remounts it with a new `key` when the set of columns changes. The cards it
 * opens are read only, so an unused value does not invite an edit.
 */
export const UnusedColumnsToggle = ({rowId, columns}: UnusedColumnsToggleProps) => {
    const [open, setOpen] = useState(false)
    if (columns.length === 0) return null

    const noun = `unused test case column${columns.length === 1 ? "" : "s"}`
    const summary = open
        ? `${columns.length} ${noun} (not referenced by the prompt)`
        : `${columns.length} ${noun} hidden because the prompt does not reference them.`

    return (
        <div className="flex min-w-0 flex-col gap-2">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((previous) => !previous)}
                className="flex items-center gap-1 self-start border-0 bg-transparent p-0 text-left text-xs text-muted-foreground"
            >
                <CollapseCaret open={open} />
                {summary}
            </button>
            {open
                ? columns.map((column) => (
                      <InputVariableCard
                          key={column.name}
                          rowId={rowId}
                          variable={{name: column.name, value: column.value}}
                          editable={false}
                          onValueChange={noop}
                      />
                  ))
                : null}
        </div>
    )
}

const noop = () => {}
