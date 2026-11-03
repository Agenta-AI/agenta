import {useCallback, useMemo, type ReactNode} from "react"

import type {RunnablePort} from "@agenta/entities/runnable"
import {workflowMolecule} from "@agenta/entities/workflow"
import {outputConnectionController, playgroundController} from "@agenta/playground"
import {KNOWN_ENVELOPE_SLOTS} from "@agenta/shared/utils"
import {
    TokenPathSuggestionsProvider,
    type TokenPathSuggestion,
    type TokenPathSuggestionsGetter,
} from "@agenta/ui/editor"
import {atom, useAtomValue} from "jotai"

const SLOTS = ["inputs", "outputs"] as const
const NO_PORTS = atom<RunnablePort[]>([])

const startsWith = (label: string, query: string) =>
    !query || label.toLowerCase().startsWith(query.toLowerCase())

/** The keys one level down a port's schema (`_pathHints` keeps multi-segment paths). */
const subKeys = (schema: unknown): string[] => {
    const shape = (schema ?? {}) as {properties?: Record<string, unknown>; _pathHints?: string[]}
    const paths = shape._pathHints?.length ? shape._pathHints : Object.keys(shape.properties ?? {})
    return [...new Set(paths.map((path) => path.split(/[.[\]'"]/).filter(Boolean)[0]))].filter(
        Boolean,
    )
}

const suggest = (
    ports: RunnablePort[],
    afterSlot: string[],
    query: string,
    hint: string,
): TokenPathSuggestion[] => {
    if (afterSlot.length === 0) {
        return ports
            .filter((port) => port.key && !KNOWN_ENVELOPE_SLOTS.has(port.key))
            .filter((port) => startsWith(port.key, query))
            .map((port) => ({label: port.key, hint}))
    }
    if (afterSlot.length === 1) {
        const port = ports.find((item) => item.key === afterSlot[0])
        return subKeys(port?.schema)
            .filter((key) => startsWith(key, query))
            .map((label) => ({label, hint: "schema"}))
    }
    return []
}

/**
 * The prompt editor's `{{$.…}}` typeahead for an evaluator that runs after an app: `$.inputs.*`
 * offers the evaluator's own inputs and the app's inputs, and `$.outputs.*` the app's outputs,
 * which is what the evaluator receives when the chain runs. Any other editor keeps the plain typeahead.
 */
export const ChainTokenPathProvider = ({
    entityId,
    children,
}: {
    entityId: string
    children: ReactNode
}) => {
    const nodes = useAtomValue(playgroundController.selectors.nodes())
    const connections = useAtomValue(outputConnectionController.selectors.allConnections())
    const node = nodes.find((item) => item.entityId === entityId)
    const sourceNodeId = connections.find((item) => item.targetNodeId === node?.id)?.sourceNodeId
    const upstreamId = nodes.find((item) => item.id === sourceNodeId)?.entityId ?? null

    const inputs = useAtomValue(
        useMemo(
            () => (upstreamId ? workflowMolecule.selectors.inputPorts(entityId) : NO_PORTS),
            [entityId, upstreamId],
        ),
    ) as RunnablePort[]
    // The evaluator receives the test case, so the app's inputs are there too.
    const appInputs = useAtomValue(
        useMemo(
            () => (upstreamId ? workflowMolecule.selectors.inputPorts(upstreamId) : NO_PORTS),
            [upstreamId],
        ),
    ) as RunnablePort[]
    const outputs = useAtomValue(
        useMemo(
            () => (upstreamId ? workflowMolecule.selectors.outputPorts(upstreamId) : NO_PORTS),
            [upstreamId],
        ),
    ) as RunnablePort[]

    const getSuggestions = useCallback<TokenPathSuggestionsGetter>(
        ([slot, ...afterSlot], query) => {
            if (slot === "inputs") {
                const keys = new Set(inputs.map((port) => port.key))
                const merged = [...inputs, ...appInputs.filter((port) => !keys.has(port.key))]
                return suggest(merged, afterSlot, query, "input")
            }
            if (slot === "outputs") return suggest(outputs, afterSlot, query, "output")
            return []
        },
        [inputs, appInputs, outputs],
    )

    if (!upstreamId) return <>{children}</>
    return (
        <TokenPathSuggestionsProvider getSuggestions={getSuggestions} allowedEnvelopeSlots={SLOTS}>
            {children}
        </TokenPathSuggestionsProvider>
    )
}
