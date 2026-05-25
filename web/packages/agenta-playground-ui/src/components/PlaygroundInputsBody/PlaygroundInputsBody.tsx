/**
 * PlaygroundInputsBody — the inputs panel inside one playground generation
 * card.
 *
 * Replaces the per-variable SharedEditor cells the playground used to render
 * via `VariableControlAdapter`. Instead, each variable gets its own bordered
 * card with:
 *   - type chip (granular, via #4394's TypeChip + inferLogicalType)
 *   - "View as ▾" dropdown (text / markdown / chat / form / json / yaml,
 *     scoped to what makes sense for the value's kind)
 *   - per-view body (SharedEditor / FormView / ChatMessageList / etc.)
 *
 * The component is presentational + atom-aware (per-variable view mode is
 * an atom family keyed by `(rowId, varName)` — see `viewModeAtoms.ts`). All
 * write-backs flow as NATIVE values via `onValueChange`. No stringification
 * on the way out (RFC: "native JSON stays native until template rendering").
 *
 * Designed to be wired into the existing OSS playground in Step 6 — this
 * branch ships the component and its primitives; Step 6 swaps the current
 * `VariableControlAdapter` rendering for `<PlaygroundInputsBody />`.
 *
 * Visibility rule (computed by the parent, passed in here):
 *   - `inputs`:               referenced variables, including draft ones.
 *                              Each gets an expanded card.
 *   - `unreferencedColumns`:  testcase columns the prompt doesn't reference.
 *                              Collapsed under a single footer row.
 *
 * The parent owns the prompt-text → referenced-variables computation (lives
 * in OSS / agenta-playground state), so this component stays pure.
 */

import type {ViewType} from "@agenta/entity-ui/view-types"
import {getDefaultViewForValue, getViewOptions} from "@agenta/entity-ui/view-types"

import {UnreferencedColumnsFooter} from "./UnreferencedColumnsFooter"
import {VariableCard} from "./VariableCard"

export interface PlaygroundInputsBodyVariable {
    /** Variable name (testcase column or template-referenced variable). */
    name: string
    /** Native value, or `undefined` for draft variables. */
    value: unknown
    /** True when the variable is referenced by the prompt but not authored
     *  on the testcase yet. Renders a `[draft]` badge. */
    isDraft?: boolean
}

export interface PlaygroundInputsBodyProps {
    /** Stable identifier for the playground generation row this card lives
     *  in. Used to key per-variable view-mode atoms — must be stable across
     *  testcase column adds (so draft variables don't lose their selected
     *  mode when the column gets persisted). */
    rowId: string
    /** Variables referenced by the prompt chain. Rendered as expanded cards
     *  in order. Include draft variables (referenced but not on testcase)
     *  with `isDraft: true`. */
    inputs: PlaygroundInputsBodyVariable[]
    /** Testcase columns NOT referenced by the prompt chain. Rendered under
     *  a single collapsed footer below all variable cards. Pass `undefined`
     *  or `[]` to skip the footer entirely. */
    unreferencedColumns?: PlaygroundInputsBodyVariable[]
    /** Whether referenced variable cards are editable. */
    editable: boolean
    /** Writes the new value for an existing column to the testcase store.
     *  Implementation should route through `testcaseMolecule.actions.update`
     *  so the testcase entity is updated atomically. NATIVE value — no
     *  stringification by the caller. */
    onValueChange: (name: string, value: unknown) => void
    /** Optional. Creates a new testcase column on first edit of a draft
     *  variable. If undefined, draft edits route through `onValueChange`
     *  and the caller decides how to persist. */
    onAddDraftColumn?: (name: string, value: unknown) => void
    /** Optional. Notified when the user changes the view mode for a card. */
    onViewModeChange?: (name: string, mode: ViewType) => void
    /** Optional. When `unreferencedColumns` is shown and the footer is
     *  expanded, gate edits to those rows. Defaults to read-only. */
    unreferencedEditable?: boolean
}

export function PlaygroundInputsBody({
    rowId,
    inputs,
    unreferencedColumns,
    editable,
    onValueChange,
    onAddDraftColumn,
    onViewModeChange,
    unreferencedEditable = false,
}: PlaygroundInputsBodyProps) {
    const handleValueChange = (name: string, value: unknown) => {
        const variable = inputs.find((v) => v.name === name)
        if (variable?.isDraft && onAddDraftColumn) {
            onAddDraftColumn(name, value)
        } else {
            onValueChange(name, value)
        }
    }

    return (
        <div className="agenta-playground-inputs-body flex flex-col gap-2">
            {inputs.map((variable) => (
                <VariableCard
                    key={variable.name}
                    rowId={rowId}
                    name={variable.name}
                    value={variable.value}
                    options={getViewOptions(variable.value)}
                    defaultMode={getDefaultViewForValue(variable.value)}
                    isDraft={variable.isDraft}
                    editable={editable}
                    onValueChange={handleValueChange}
                    onViewModeChange={onViewModeChange}
                />
            ))}
            {unreferencedColumns && unreferencedColumns.length > 0 ? (
                <UnreferencedColumnsFooter
                    rowId={rowId}
                    columns={unreferencedColumns.map((c) => ({name: c.name, value: c.value}))}
                    editable={unreferencedEditable}
                    onValueChange={
                        unreferencedEditable
                            ? (name, value) => onValueChange(name, value)
                            : undefined
                    }
                />
            ) : null}
        </div>
    )
}
