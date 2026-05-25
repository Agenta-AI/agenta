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
 * by one — no special handling here.
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
    const [expanded, setExpanded] = useState(false)

    if (columns.length === 0) return null

    const summary = `${columns.length} unused testcase column${columns.length === 1 ? "" : "s"} hidden because the prompt does not reference them.`

    return (
        <div className="agenta-unreferenced-footer mt-2 flex flex-col gap-2">
            <Button
                type="text"
                size="small"
                icon={expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
                onClick={() => setExpanded((prev) => !prev)}
                aria-expanded={expanded}
                className="self-start text-[12px] !text-[rgba(5,23,41,0.55)]"
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
