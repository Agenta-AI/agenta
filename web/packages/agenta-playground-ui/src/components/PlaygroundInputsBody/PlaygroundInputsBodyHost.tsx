/**
 * PlaygroundInputsBodyHost — atom-aware wrapper around `PlaygroundInputsBody`.
 *
 * Bridges the playground execution state to the presentational component:
 *   - `inputs` + `unreferencedColumns` come from
 *     `executionItemController.selectors.inputsVisibility({testcaseId, downstreamKey})`.
 *   - Edits flow to `executionItemController.actions.setTestcaseCellValue`,
 *     which writes through `testcaseMolecule.actions.update` so the testcase
 *     entity is the single source of truth.
 *   - Draft variables (referenced by prompt but absent from testcase) write
 *     through the SAME action — `setTestcaseCellValue` is happy to create a
 *     new column on first set, so we don't need a separate `onAddDraftColumn`.
 *
 * This is the integration point used by `SingleLayout` when the
 * `useNewPlaygroundInputsBodyAtom` feature flag is on. ComparisonLayout will
 * follow in a future commit.
 */

import {useCallback, useMemo} from "react"

import {executionItemController} from "@agenta/playground"
import {useAtomValue, useSetAtom} from "jotai"

import {PlaygroundInputsBody} from "./PlaygroundInputsBody"

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
}

export function PlaygroundInputsBodyHost({
    rowId,
    downstreamKey,
    editable,
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
            inputs={visibility.inputs}
            unreferencedColumns={visibility.unreferencedColumns}
            editable={editable}
            onValueChange={handleValueChange}
            // Draft variables route through the same `setTestcaseCellValue`
            // reducer — it creates the new column on first set.
            onAddDraftColumn={handleValueChange}
        />
    )
}
