/**
 * Parameters source — `{{$.parameters.*}}` suggestions.
 *
 * Schema-backed. Reads the unioned `schemas.parameters` across every
 * playground node so evaluator and app prompts both pick up relevant
 * keys. Deeper walks (into nested parameter objects) fall through to
 * the plugin's seen-tokens fallback.
 */

import {useMemo} from "react"

import type {TokenPathSuggestion} from "@agenta/ui/editor"
import {useAtomValue} from "jotai"

import {aggregatedParametersSchemaAtom} from "../atoms"
import type {EnvelopeSource} from "../types"

import {getSubPathsFromSchema, queryMatches} from "./shared"

const SLOT = "parameters"

export function useParametersSource(): EnvelopeSource {
    const schema = useAtomValue(aggregatedParametersSchemaAtom)

    return useMemo<EnvelopeSource>(
        () => ({
            slot: SLOT,
            getSuggestions(afterSlot, query) {
                if (!schema) return []

                // Depth 1: `{{$.parameters.<here>}}` — top-level keys of
                // the unioned parameters schema.
                if (afterSlot.length === 0) {
                    const out: TokenPathSuggestion[] = []
                    for (const key of getSubPathsFromSchema(schema)) {
                        if (!queryMatches(key, query)) continue
                        out.push({label: key, hint: "param"})
                    }
                    return out
                }

                // Depth 2: one level into a specific parameter's sub-schema,
                // if declared. Most parameters are scalars so this is
                // usually a no-op, but e.g. `llm_config` has structure.
                if (afterSlot.length === 1) {
                    const [root] = afterSlot
                    const nested = (schema.properties as Record<string, unknown>)[root]
                    const out: TokenPathSuggestion[] = []
                    for (const key of getSubPathsFromSchema(nested)) {
                        if (!queryMatches(key, query)) continue
                        out.push({label: key, hint: "param"})
                    }
                    return out
                }

                return []
            },
        }),
        [schema],
    )
}
