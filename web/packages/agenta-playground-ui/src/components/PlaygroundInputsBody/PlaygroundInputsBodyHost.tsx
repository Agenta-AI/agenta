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

import {loadableController} from "@agenta/entities/runnable"
import {executionItemController, playgroundController} from "@agenta/playground"
import {atom, useAtomValue, useSetAtom} from "jotai"

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

    // Read the input port schema map so we can inject helpText + declared
    // port type + JSON-schema fragment onto each variable entry:
    //   - `helpText`       → evaluator envelope variables (`inputs`/`outputs`)
    //                          keep the legacy guidance tooltip.
    //   - `expectedType`   → drives the default view mode + TypeChip for
    //                          DRAFT variables (no value yet). Without it, a
    //                          `geo` port referenced via `{{geo.region}}`
    //                          opens as a text input with a `null` chip
    //                          instead of Form + `object` chip.
    //   - `expectedSchema` → seeds Form / JSON / YAML modes on drafts with an
    //                          empty-value skeleton matching the expected
    //                          sub-fields (so `geo` shows `region`, `subregion`,
    //                          `coordinates.lat/lng` before the user types).
    const portSchemaMap = useAtomValue(
        executionItemController.selectors.inputPortSchemaMap,
    ) as Record<string, {helpText?: string; type?: string; schema?: unknown}>

    const enrichedInputs = useMemo<PlaygroundInputsBodyVariable[]>(
        () =>
            visibility.inputs.map((v) => {
                const portSchema = portSchemaMap[v.name]
                const help = portSchema?.helpText
                const type = portSchema?.type as PlaygroundInputsBodyVariable["expectedType"]
                const schema = portSchema?.schema
                if (!help && !type && !schema) return v
                return {
                    ...v,
                    ...(help ? {helpText: help} : {}),
                    ...(type ? {expectedType: type} : {}),
                    ...(schema ? {expectedSchema: schema} : {}),
                }
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

    // Connected-source name (set when the row is sourced from a testset
    // rather than authored locally). Every card uses this to surface the
    // unified database indicator — same per-card, gated by the global
    // loadable state.
    const loadableId = useAtomValue(
        useMemo(() => playgroundController.selectors.loadableId(), []),
    ) as string | null
    // Build a single read-only atom that returns the connected-source
    // descriptor (or null when no loadable is mounted). The cast through
    // `unknown` keeps the conditional atom typeable — the runtime always
    // returns the `{id, name, type}` shape (or null), but the atom-family
    // factory has its own readonly atom type that wouldn't normally union
    // cleanly with a fallback `atom(() => null)`.
    const connectedSourceAtom = useMemo(
        () =>
            loadableId
                ? loadableController.selectors.connectedSource(loadableId)
                : (atom(() => null) as unknown as ReturnType<
                      typeof loadableController.selectors.connectedSource
                  >),
        [loadableId],
    )
    const connectedSource = useAtomValue(connectedSourceAtom) as {
        id: string | null
        name: string | null
    } | null
    const connectedSourceName = connectedSource?.id ? (connectedSource.name ?? null) : null

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
            // Unreferenced columns are testcase data the user authored —
            // they should be editable when the footer is expanded, same as
            // any other variable card. The prop defaults to `false` in
            // `PlaygroundInputsBody` (defensive — read-only display
            // surfaces can opt out), so we explicitly pass `editable`
            // here to match the rest of the inputs body.
            unreferencedEditable={editable}
            onValueChange={handleValueChange}
            // Draft variables route through the same `setTestcaseCellValue`
            // reducer — it creates the new column on first set.
            onAddDraftColumn={handleValueChange}
            connectedSourceName={connectedSourceName}
            templateFormat={templateFormat}
        />
    )
}
