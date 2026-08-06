/**
 * Inputs source — `{{$.inputs.*}}` suggestions.
 *
 * Composes three signals:
 *   - Port keys (authoritative, from grouped prompt variables — clean
 *     field names like "arda", "country").
 *   - Testcase root keys (authoritative, from manually added columns).
 *   - Observed sub-keys inside testcase cells (inferred from user fills
 *     for object-typed variables).
 *
 * When called with `scopedEntityId`, reads that entity's input ports
 * directly — so a prompt inside an evaluator only sees the evaluator's
 * own declared inputs, not every input across the playground. When
 * called without a scope, falls back to the global aggregated port map
 * (used by editors mounted outside any specific node).
 */

import {useMemo} from "react"

import type {RunnablePort} from "@agenta/entities/runnable"
import {workflowMolecule} from "@agenta/entities/workflow"
import {executionItemController} from "@agenta/playground"
import {KNOWN_ENVELOPE_SLOTS} from "@agenta/shared/utils"
import type {TokenPathSuggestion} from "@agenta/ui/editor"
import {atom, useAtomValue} from "jotai"

import {observedTestcasesAtom} from "../atoms"
import type {EnvelopeSource} from "../types"

import {collectNextKeysAtPath, getSubPathsFromSchema, queryMatches} from "./shared"

interface PortInfo {
    type: string
    name?: string
    schema?: unknown
}

const SLOT = "inputs"
const EMPTY_PORTS_ATOM = atom<RunnablePort[]>([])

export function useInputsSource(scopedEntityId: string | null = null): EnvelopeSource {
    const globalSchemaMap = useAtomValue(
        executionItemController.selectors.inputPortSchemaMap,
    ) as Record<string, PortInfo>

    // Read the scoped entity's input ports when an entity id is given;
    // subscribe to a frozen empty atom otherwise so the hook shape stays
    // stable across renders.
    const scopedPortsAtom = useMemo(
        () =>
            scopedEntityId
                ? workflowMolecule.selectors.inputPorts(scopedEntityId)
                : EMPTY_PORTS_ATOM,
        [scopedEntityId],
    )
    const scopedPorts = useAtomValue(scopedPortsAtom) as RunnablePort[]

    const schemaMap = useMemo<Record<string, PortInfo>>(() => {
        if (!scopedEntityId) return globalSchemaMap
        const map: Record<string, PortInfo> = {}
        for (const port of scopedPorts) {
            if (port.key && !(port.key in map)) {
                map[port.key] = {type: port.type, name: port.name, schema: port.schema}
            }
        }
        return map
    }, [scopedEntityId, scopedPorts, globalSchemaMap])

    const observedTestcases = useAtomValue(observedTestcasesAtom)

    return useMemo<EnvelopeSource>(
        () => ({
            slot: SLOT,
            getSuggestions(afterSlot, query) {
                // Depth 1: `{{$.inputs.<here>}}` — suggest root variable
                // names, unioned from port keys and testcase data keys.
                if (afterSlot.length === 0) {
                    const roots = new Set<string>(Object.keys(schemaMap))
                    for (const tc of observedTestcases) {
                        const data =
                            tc && typeof tc === "object"
                                ? ((tc as {data?: Record<string, unknown>}).data ?? {})
                                : {}
                        for (const rootKey of Object.keys(data)) {
                            // Skip internal bookkeeping keys.
                            if (rootKey === "testcase_dedup_id") continue
                            roots.add(rootKey)
                        }
                    }
                    // Strip envelope-slot names — they're envelope identifiers,
                    // not field names inside the inputs envelope. Evaluators
                    // surface envelope-level ports keyed `inputs`/`outputs`
                    // (see `buildEvaluatorEnvelopePorts`), so without this
                    // filter the typeahead would offer `$.inputs.inputs` /
                    // `$.inputs.outputs` — self-referential / cross-envelope
                    // paths the SDK runtime can't resolve. Users should be
                    // guided to `{{$.inputs}}` / `{{$.outputs}}` or to a
                    // specific field like `{{$.inputs.country}}` instead.
                    for (const slot of KNOWN_ENVELOPE_SLOTS) {
                        roots.delete(slot)
                    }
                    const out: TokenPathSuggestion[] = []
                    for (const r of roots) {
                        if (!queryMatches(r, query)) continue
                        out.push({label: r, hint: "input"})
                    }
                    return out
                }

                // Depth 2: `{{$.inputs.<root>.<here>}}` — suggest sub-keys,
                // schema wins over testcase-observed on label conflict.
                if (afterSlot.length === 1) {
                    const [root] = afterSlot
                    const seen = new Set<string>()
                    const out: TokenPathSuggestion[] = []

                    for (const sp of getSubPathsFromSchema(schemaMap[root]?.schema)) {
                        const first = sp.split(/[.[\]'"]/).filter(Boolean)[0]
                        if (!first || seen.has(first) || !queryMatches(first, query)) continue
                        seen.add(first)
                        out.push({label: first, hint: "schema"})
                    }

                    for (const tc of observedTestcases) {
                        const data =
                            tc && typeof tc === "object"
                                ? ((tc as {data?: Record<string, unknown>}).data ?? {})
                                : {}
                        const cell = (data as Record<string, unknown>)[root]
                        for (const sk of collectNextKeysAtPath(cell, [])) {
                            if (seen.has(sk) || !queryMatches(sk, query)) continue
                            seen.add(sk)
                            out.push({label: sk, hint: "testcase"})
                        }
                    }

                    return out
                }

                // Depth 3+: cede to the plugin's previously-seen fallback.
                // Ports collapse at depth 2 in our grouping model, so we
                // don't have structured data deeper than that.
                return []
            },
        }),
        [schemaMap, observedTestcases],
    )
}
