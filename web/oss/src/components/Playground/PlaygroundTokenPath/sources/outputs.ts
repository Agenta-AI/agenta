/**
 * Outputs source — `{{$.outputs.*}}` suggestions.
 *
 * Reads the playground's output port schema map, which is populated
 * either from a workflow's declared `schemas.outputs` or inferred from
 * trace metadata for ephemeral workflows. Either way the source stays
 * purely schema-driven — runtime inference already happens upstream.
 */

import {useMemo} from "react"

import {executionItemController} from "@agenta/playground"
import type {TokenPathSuggestion} from "@agenta/ui/editor"
import {useAtomValue} from "jotai"

import type {EnvelopeSource} from "../types"

import {getSubPathsFromSchema, queryMatches} from "./shared"

interface PortInfo {
    type: string
    name?: string
    schema?: unknown
}

const SLOT = "outputs"

export function useOutputsSource(): EnvelopeSource {
    const schemaMap = useAtomValue(executionItemController.selectors.outputPortSchemaMap) as Record<
        string,
        PortInfo
    >

    return useMemo<EnvelopeSource>(
        () => ({
            slot: SLOT,
            getSuggestions(afterSlot, query) {
                // Depth 1: `{{$.outputs.<here>}}` — top-level output fields.
                if (afterSlot.length === 0) {
                    const out: TokenPathSuggestion[] = []
                    for (const key of Object.keys(schemaMap)) {
                        if (!queryMatches(key, query)) continue
                        out.push({label: key, hint: "output"})
                    }
                    return out
                }

                // Depth 2: `{{$.outputs.<field>.<here>}}` — nested sub-paths
                // if the output port carries a structured schema. Most
                // outputs are scalars; this is a safety net for rich
                // outputs like `completion.content`.
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
                    return out
                }

                return []
            },
        }),
        [schemaMap],
    )
}
