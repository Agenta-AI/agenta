/**
 * Outputs source — `{{$.outputs.*}}` suggestions scoped to a specific
 * upstream entity.
 *
 * `$.outputs` in a prompt resolves to whatever the node *immediately
 * upstream* of this editor's node produced. The scoping is delegated to
 * the provider: when the caller passes an `upstreamEntityId`, we read
 * that entity's output ports directly from its workflow molecule. When
 * no upstream exists (depth-0 node, or editor mounted outside any node),
 * the source contributes nothing.
 */

import {useMemo} from "react"

import type {RunnablePort} from "@agenta/entities/runnable"
import {workflowMolecule} from "@agenta/entities/workflow"
import {KNOWN_ENVELOPE_SLOTS} from "@agenta/shared/utils"
import type {TokenPathSuggestion} from "@agenta/ui/editor"
import {atom} from "jotai"
import {useAtomValue} from "jotai"

import type {EnvelopeSource} from "../types"

import {getSubPathsFromSchema, queryMatches} from "./shared"

interface PortInfo {
    type: string
    name?: string
    schema?: unknown
}

const SLOT = "outputs"
const EMPTY_PORTS_ATOM = atom<RunnablePort[]>([])

export function useOutputsSource(upstreamEntityId: string | null): EnvelopeSource {
    // Conditional atom subscription: when no upstream is resolved (e.g.
    // this editor sits on a depth-0 node), we subscribe to a frozen empty
    // atom so the hook shape stays stable across renders.
    const portsAtom = useMemo(
        () =>
            upstreamEntityId
                ? workflowMolecule.selectors.outputPorts(upstreamEntityId)
                : EMPTY_PORTS_ATOM,
        [upstreamEntityId],
    )
    const ports = useAtomValue(portsAtom) as RunnablePort[]

    const schemaMap = useMemo<Record<string, PortInfo>>(() => {
        const map: Record<string, PortInfo> = {}
        for (const port of ports) {
            if (port.key && !(port.key in map)) {
                map[port.key] = {type: port.type, name: port.name, schema: port.schema}
            }
        }
        return map
    }, [ports])

    return useMemo<EnvelopeSource>(
        () => ({
            slot: SLOT,
            getSuggestions(afterSlot, query) {
                // Depth 1: `{{$.outputs.<here>}}` — top-level output fields
                // of the upstream node.
                if (afterSlot.length === 0) {
                    const out: TokenPathSuggestion[] = []
                    for (const key of Object.keys(schemaMap)) {
                        // Skip envelope-slot names — see the matching filter
                        // in `useInputsSource` for the same reasoning. An
                        // evaluator's output port keyed `outputs` would
                        // otherwise produce `{{$.outputs.outputs}}`, which
                        // is a self-referential path the runtime can't
                        // resolve.
                        if (KNOWN_ENVELOPE_SLOTS.has(key)) continue
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
