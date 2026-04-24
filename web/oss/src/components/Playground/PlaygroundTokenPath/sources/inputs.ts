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
 * Under the envelope/key refactor, port keys ARE the clean field names
 * under `$.inputs.*`, so no path surgery is needed here — we read keys
 * directly from the schema map.
 */

import {useMemo} from "react"

import {executionItemController} from "@agenta/playground"
import type {TokenPathSuggestion} from "@agenta/ui/editor"
import {useAtomValue} from "jotai"

import {observedTestcasesAtom} from "../atoms"
import type {EnvelopeSource} from "../types"

import {collectNextKeysAtPath, getSubPathsFromSchema, queryMatches} from "./shared"

interface PortInfo {
    type: string
    name?: string
    schema?: unknown
}

const SLOT = "inputs"

export function useInputsSource(): EnvelopeSource {
    const schemaMap = useAtomValue(executionItemController.selectors.inputPortSchemaMap) as Record<
        string,
        PortInfo
    >
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
