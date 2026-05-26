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
 *   - Draft variables (referenced by prompt but absent from testcase) write
 *     through the SAME action — `setTestcaseCellValue` is happy to create a
 *     new column on first set, so we don't need a separate `onAddDraftColumn`.
 *   - Optional `sections` prop partitions visibility.inputs into named groups
 *     (left-border accent), used by the evaluator grouped layout in
 *     SingleLayout.
 */

import {useCallback, useMemo} from "react"

import {executionItemController} from "@agenta/playground"
import {useAtomValue, useSetAtom} from "jotai"

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
}

export function PlaygroundInputsBodyHost({
    rowId,
    downstreamKey,
    editable,
    sections,
}: PlaygroundInputsBodyHostProps) {
    const visibility = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.inputsVisibility({
                    testcaseId: rowId,
                    downstreamKey,
                }),
            [rowId, downstreamKey],
        ),
    )

    // Read the input port schema map so we can inject helpText (and any
    // other port-level metadata in the future) onto the variable entries.
    // Only port schemas with a `helpText` field surface a tooltip; everything
    // else falls through unchanged.
    const portSchemaMap = useAtomValue(
        executionItemController.selectors.inputPortSchemaMap,
    ) as Record<string, {helpText?: string}>

    const enrichedInputs = useMemo<PlaygroundInputsBodyVariable[]>(
        () =>
            visibility.inputs.map((v) => {
                const help = portSchemaMap[v.name]?.helpText
                return help ? {...v, helpText: help} : v
            }),
        [visibility.inputs, portSchemaMap],
    )

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

    const setCellValue = useSetAtom(executionItemController.actions.setTestcaseCellValue)

    const handleValueChange = useCallback(
        (name: string, value: unknown) => {
            setCellValue({testcaseId: rowId, column: name, value})
        },
        [setCellValue, rowId],
    )

    return (
        <PlaygroundInputsBody
            rowId={rowId}
            inputs={enrichedInputs}
            sections={bodySections}
            unreferencedColumns={visibility.unreferencedColumns}
            editable={editable}
            onValueChange={handleValueChange}
            // Draft variables route through the same `setTestcaseCellValue`
            // reducer — it creates the new column on first set.
            onAddDraftColumn={handleValueChange}
        />
    )
}
