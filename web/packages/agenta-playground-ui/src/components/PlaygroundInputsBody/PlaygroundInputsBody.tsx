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

import type {ExpectedType, ViewType} from "@agenta/entity-ui/view-types"
import {
    getDefaultViewForExpectedType,
    getViewOptionsForExpectedType,
} from "@agenta/entity-ui/view-types"

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
    /** Optional tooltip text explaining the variable's role. Surfaced as a
     *  small Info icon in the card header — used for evaluator envelope
     *  variables (`inputs`/`outputs`) to keep the legacy guidance visible. */
    helpText?: string
    /** Declared port type from the runnable schema (`object` / `array` /
     *  `string` / `number` / `integer` / `boolean`). When the variable is
     *  a draft (no value yet), this drives the default view mode and the
     *  TypeChip variant so the card opens in the right shape — e.g. a
     *  `geo` port referenced via `{{geo.region}}` opens as Form with an
     *  `object` chip instead of a text input with a `null` chip. */
    expectedType?: ExpectedType
    /** Declared port schema (JSON Schema fragment with `properties` /
     *  `_pathHints`). When the variable is a draft, Form / JSON / YAML
     *  modes pre-render an empty-value skeleton matching this shape so
     *  the user sees the expected sub-fields without having to add them
     *  manually. Render-only — the testcase value stays untouched until
     *  the user actually edits a field. */
    expectedSchema?: unknown
}

/**
 * Optional section grouping for the variable cards. When present (see
 * `PlaygroundInputsBodyProps.sections` below), each section renders inside
 * a left-border accent block — mirrors the legacy `<SectionBlock>` look the
 * grouped evaluator layout used in `SingleLayout`. Variable cards inside a
 * section behave exactly like ungrouped cards otherwise.
 */
export interface PlaygroundInputsBodySection {
    /** Aria label for the group (e.g. `"inputs"` / `"outputs"`). Not
     *  rendered as a visible heading — the left-border + the per-card
     *  TypeChip + name carry the disambiguation. */
    ariaLabel: string
    /** Variables rendered inside this section, in order. */
    variables: PlaygroundInputsBodyVariable[]
}

export interface PlaygroundInputsBodyProps {
    /** Stable identifier for the playground generation row this card lives
     *  in. Used to key per-variable view-mode atoms — must be stable across
     *  testcase column adds (so draft variables don't lose their selected
     *  mode when the column gets persisted). */
    rowId: string
    /** Variables referenced by the prompt chain. Rendered as expanded cards
     *  in order. Include draft variables (referenced but not on testcase)
     *  with `isDraft: true`. Ignored when `sections` is provided. */
    inputs: PlaygroundInputsBodyVariable[]
    /** Optional grouped layout. When present, replaces the flat `inputs`
     *  rendering with one left-border block per section. Used by the
     *  evaluator grouped layout (`inputs` envelope + extracted field ports
     *  in one block, `outputs` envelope in another). */
    sections?: PlaygroundInputsBodySection[]
    /** Testcase columns NOT referenced by the prompt chain. Rendered under
     *  a single collapsed footer below all variable cards. Pass `undefined`
     *  or `[]` to skip the footer entirely. */
    unreferencedColumns?: PlaygroundInputsBodyVariable[]
    /** Whether referenced variable cards are editable. */
    editable: boolean
    /** When non-empty, every card shows a small database indicator in the
     *  header — `Synced from {name}`. Communicates that the row's data
     *  comes from a testset rather than being authored locally. */
    connectedSourceName?: string | null
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
    /** Active prompt template format. Forwarded to every `VariableCard`
     *  so chat-mode rendering tokenizes the right `{{...}}` syntax. */
    templateFormat?: "mustache" | "curly" | "fstring" | "jinja2"
}

export function PlaygroundInputsBody({
    rowId,
    inputs,
    sections,
    unreferencedColumns,
    editable,
    onValueChange,
    onAddDraftColumn,
    onViewModeChange,
    unreferencedEditable = false,
    connectedSourceName,
    templateFormat,
}: PlaygroundInputsBodyProps) {
    // `sections` takes precedence over the flat `inputs` list. We still need
    // to look up by name to route draft edits, so unify the membership
    // source here.
    const allVariables: PlaygroundInputsBodyVariable[] = sections
        ? sections.flatMap((s) => s.variables)
        : inputs

    const handleValueChange = (name: string, value: unknown) => {
        const variable = allVariables.find((v) => v.name === name)
        if (variable?.isDraft && onAddDraftColumn) {
            onAddDraftColumn(name, value)
        } else {
            onValueChange(name, value)
        }
    }

    const renderCard = (variable: PlaygroundInputsBodyVariable) => (
        <VariableCard
            key={variable.name}
            rowId={rowId}
            name={variable.name}
            value={variable.value}
            options={getViewOptionsForExpectedType(variable.value, variable.expectedType)}
            defaultMode={getDefaultViewForExpectedType(
                variable.value,
                variable.expectedType,
                variable.expectedSchema,
            )}
            isDraft={variable.isDraft}
            helpText={variable.helpText}
            expectedType={variable.expectedType}
            expectedSchema={variable.expectedSchema}
            editable={editable}
            onValueChange={handleValueChange}
            onViewModeChange={onViewModeChange}
            connectedSourceName={connectedSourceName}
            templateFormat={templateFormat}
        />
    )

    return (
        <div className="agenta-playground-inputs-body flex flex-col gap-2 min-w-0">
            {sections
                ? sections.map((section) => (
                      <div
                          key={section.ariaLabel}
                          role="group"
                          aria-label={section.ariaLabel}
                          // Mirrors the legacy `<SectionBlock>` accent in
                          // `SingleLayout`. No visible heading — the chip + name
                          // on each card carries the per-variable label, and the
                          // left-border conveys the group identity.
                          className="flex flex-col gap-2 pl-3 border-0 border-l-2 border-solid border-[var(--ag-c-1677FF22)]"
                      >
                          {section.variables.map(renderCard)}
                      </div>
                  ))
                : inputs.map(renderCard)}
            {unreferencedColumns && unreferencedColumns.length > 0 ? (
                <UnreferencedColumnsFooter
                    // Key the footer on the set of unused column names so it
                    // re-mounts whenever a column migrates in or out — that
                    // resets `useState(false)` to keep the new unused entry
                    // collapsed by default. Per Mahmoud/Arda's QA, the
                    // unused values must never surface without an explicit
                    // click. See `UnreferencedColumnsFooter` docstring.
                    key={unreferencedColumns.map((c) => c.name).join("|")}
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
