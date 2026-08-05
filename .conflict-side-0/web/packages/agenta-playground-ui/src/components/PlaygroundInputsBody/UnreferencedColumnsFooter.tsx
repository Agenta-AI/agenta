/**
 * UnreferencedColumnsFooter — collapsed-by-default footer rendered once
 * below all variable cards.
 *
 * "N unused testcase columns hidden because the prompt does not reference
 *  them." Click to expand and render the unreferenced columns as collapsed
 *  read-only cards beneath.
 *
 * Rendered ONCE per generation card (not per variable). When the prompt
 * adds a reference to a previously-unused column, the parent moves that
 * entry from `unreferencedColumns` to `inputs` and the footer count drops
 * by one. When the prompt REMOVES a reference, the value migrates here.
 *
 * Collapsed-by-default behaviour (per Mahmoud/Arda QA on 2026-05-28):
 * the unused values must not surface unsolicited. The footer is keyed by
 * its column-name list (see `<UnreferencedColumnsFooter key=… />` in
 * `PlaygroundInputsBody`), so any change to the unused set — a new column
 * migrating in, a column re-promoted out — remounts the footer and resets
 * the local `expanded` state to `false`. Users see the new count without
 * the previously-expanded reveal leaking the just-moved value.
 */

import {useState} from "react"

import {getDefaultViewForValue, getViewOptions} from "@agenta/entity-ui/view-types"
import {CaretDown, CaretRight} from "@phosphor-icons/react"
import {Button} from "antd"

import {VariableCard} from "./VariableCard"

interface UnreferencedColumn {
    name: string
    value: unknown
}

interface UnreferencedColumnsFooterProps {
    /** Stable identifier for the generation row this footer lives in. */
    rowId: string
    columns: UnreferencedColumn[]
    /** Whether expanded cards are editable. Most surfaces will pass `false`
     *  here — unused columns shouldn't tempt the user into editing them.
     *  Set `true` if the parent wants edits to be allowed once revealed. */
    editable?: boolean
    /** Fires when the user edits a previously-unused column. Most callers
     *  will leave this undefined (read-only). */
    onValueChange?: (name: string, value: unknown) => void
}

export function UnreferencedColumnsFooter({
    rowId,
    columns,
    editable = false,
    onValueChange,
}: UnreferencedColumnsFooterProps) {
    // Collapsed by default. The parent component re-mounts this footer
    // whenever the column-name set changes (via a `key` prop derived from
    // the column names) so this default re-asserts every time a new column
    // migrates in — see the file-level docstring for the rationale.
    const [expanded, setExpanded] = useState(false)

    if (columns.length === 0) return null

    // Word the summary to match the visible state. When expanded, the
    // columns ARE visible below — saying "hidden" would be misleading.
    const noun = `unused testcase column${columns.length === 1 ? "" : "s"}`
    const summary = expanded
        ? `${columns.length} ${noun} (not referenced by the prompt)`
        : `${columns.length} ${noun} hidden because the prompt does not reference them.`

    return (
        <div className="agenta-unreferenced-footer mt-2 flex flex-col gap-2">
            <Button
                type="text"
                size="small"
                icon={expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
                onClick={() => setExpanded((prev) => !prev)}
                aria-expanded={expanded}
                className="self-start text-[12px] !text-[var(--ag-rgba-051729-55)]"
            >
                {summary}
            </Button>
            {expanded ? (
                <div className="flex flex-col gap-2">
                    {columns.map((col) => (
                        <VariableCard
                            key={col.name}
                            rowId={rowId}
                            name={col.name}
                            value={col.value}
                            options={getViewOptions(col.value)}
                            defaultMode={getDefaultViewForValue(col.value)}
                            editable={editable}
                            onValueChange={
                                onValueChange ??
                                (() => {
                                    /* no-op when parent didn't supply a handler */
                                })
                            }
                        />
                    ))}
                </div>
            ) : null}
        </div>
    )
}
