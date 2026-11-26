/**
 * PlaygroundInputsBodyHost — atom-aware wrapper around `PlaygroundInputsBody`.
 *
 * Bridges the playground execution state to the presentational component:
 *   - `inputs` + `unreferencedColumns` come from
 *     `executionItemController.selectors.inputsVisibility({testcaseId, downstreamKey})`.
 *   - `helpText` per variable comes from `inputPortSchemaMap` — used by the
 *     evaluator envelope variables (`inputs`/`outputs`) to keep the legacy
 *     guidance tooltip visible after the migration.
 *   - Edits flow to `executionItemController.actions.setTestcaseCellValue`,
 *     which writes through `testcaseMolecule.actions.update` so the testcase
 *     entity is the single source of truth.
 *   - Variables referenced by prompt but absent from testcase write through
 *     the SAME action — `setTestcaseCellValue` creates a new column on first
 *     set, so we don't need a separate missing-column action.
 *   - Optional `sections` prop partitions visibility.inputs into named groups
 *     (left-border accent), used by the evaluator grouped layout in
 *     SingleLayout.
 */

import {useMemo} from "react"

import {usePlaygroundInputsModel} from "../../hooks/usePlaygroundInputsModel"

import {PlaygroundInputsBody} from "./PlaygroundInputsBody"
import type {
    PlaygroundInputsBodySection,
    PlaygroundInputsBodyVariable,
} from "./PlaygroundInputsBody"

export interface PlaygroundInputsBodyHostProps {
    /** Testcase row ID (also the playground generation row ID — they're
     *  the same in the loadable routing per the testcaseMolecule contract). */
    rowId: string
    /** Downstream key used by the visibility selector to namespace its
     *  computation per-evaluator-chain. Should match the key the caller
     *  uses with `variableKeysForDownstream`. */
    downstreamKey: string
    /** Whether the cards are editable (vs read-only). */
    editable: boolean
    /** Optional grouped layout. Each entry pulls the named variables out of
     *  `visibility.inputs` into a dedicated section. Variables NOT listed in
     *  any section stay in their original order under no group block; in
     *  practice the caller lists every referenced key so this is rare.
     *  Order of sections is preserved as-passed. */
    sections?: {
        ariaLabel: string
        variableNames: string[]
    }[]
    /** Active prompt template format. Forwarded to every variable card so
     *  chat-mode rendering tokenizes the right `{{...}}` syntax. The
     *  caller resolves this from the primary entity's prompt config — the
     *  host doesn't read it itself because it has no single canonical
     *  entity in comparison layouts (multiple variants may differ). */
    templateFormat?: "mustache" | "curly" | "fstring" | "jinja2"
}

export function PlaygroundInputsBodyHost({
    rowId,
    downstreamKey,
    editable,
    sections,
    templateFormat,
}: PlaygroundInputsBodyHostProps) {
    const {
        inputs: enrichedInputs,
        unreferencedColumns,
        connectedSourceName,
        setValue: handleValueChange,
    } = usePlaygroundInputsModel({rowId, downstreamKey})

    // Partition enriched inputs into sections when `sections` is provided.
    // Variables not listed in any section are appended as ungrouped at the
    // end (caller responsibility to list every key for a clean layout).
    const bodySections = useMemo<PlaygroundInputsBodySection[] | undefined>(() => {
        if (!sections) return undefined
        const byName = new Map(enrichedInputs.map((v) => [v.name, v]))
        const claimed = new Set<string>()
        const groups: PlaygroundInputsBodySection[] = sections.map((spec) => {
            const variables: PlaygroundInputsBodyVariable[] = []
            for (const name of spec.variableNames) {
                const v = byName.get(name)
                if (!v) continue
                variables.push(v)
                claimed.add(name)
            }
            return {ariaLabel: spec.ariaLabel, variables}
        })
        const leftover = enrichedInputs.filter((v) => !claimed.has(v.name))
        if (leftover.length > 0) {
            groups.push({ariaLabel: "other", variables: leftover})
        }
        return groups
    }, [sections, enrichedInputs])

    return (
        <PlaygroundInputsBody
            rowId={rowId}
            inputs={enrichedInputs}
            sections={bodySections}
            unreferencedColumns={unreferencedColumns}
            editable={editable}
            // Unreferenced columns are testcase data the user authored —
            // they should be editable when the footer is expanded, same as
            // any other variable card. The prop defaults to `false` in
            // `PlaygroundInputsBody` (defensive — read-only display
            // surfaces can opt out), so we explicitly pass `editable`
            // here to match the rest of the inputs body.
            unreferencedEditable={editable}
            onValueChange={handleValueChange}
            // Kept for compatibility with any caller-provided draft cards.
            // Missing prompt variables already route through `onValueChange`,
            // and `setTestcaseCellValue` creates the new column on first set.
            onAddDraftColumn={handleValueChange}
            connectedSourceName={connectedSourceName}
            templateFormat={templateFormat}
        />
    )
}
