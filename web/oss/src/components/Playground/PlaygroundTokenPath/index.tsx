/**
 * PlaygroundTokenPathProvider
 *
 * Feeds the prompt editor's JSONPath typeahead with suggestions via a
 * per-envelope source abstraction. Each source is a self-subscribing
 * React hook that owns its data access (port schemas, observed
 * testcases, workflow parameters, ...) and its depth policy.
 *
 * Two mount points:
 *   - Global provider (`PlaygroundTokenPathProvider`) wraps the whole
 *     playground and offers only `inputs`. It covers editors that sit
 *     outside any specific node — testcase drawers, detached tools.
 *   - Scoped provider (`PlaygroundNodeTokenPathProvider`) wraps a single
 *     node's editor subtree. It adds `outputs` when the node has an
 *     upstream dependency in the chain DAG, scoped to that upstream's
 *     output-port schema (mirrors what `auto_ai_critique_v0` actually
 *     binds into its template context at runtime).
 *
 * Adding a new envelope = add a source file + register it in whichever
 * provider should surface it. The dispatcher itself stays trivial.
 *
 * See `types.ts` for the source contract and `sources/` for the
 * per-envelope implementations.
 */

import {useCallback, useMemo, type ReactElement, type ReactNode} from "react"

import {TokenPathSuggestionsProvider, type TokenPathSuggestionsGetter} from "@agenta/ui/editor"
import {useAtomValue} from "jotai"

import {nodeChainContextAtomFamily} from "./chainContext"
import {useInputsSource} from "./sources/inputs"
import {useOutputsSource} from "./sources/outputs"
// import {useParametersSource} from "./sources/parameters"
// import {useTestcaseSource} from "./sources/testcase"
import type {EnvelopeSource} from "./types"

/**
 * Envelope slots the global provider offers at depth 0. `outputs` is
 * intentionally excluded here — outside a chain context we can't
 * promise an upstream node's output schema will be populated, and
 * `$.outputs.*` would fail to resolve at runtime. The scoped provider
 * below adds it back when a real upstream is known.
 */
const GLOBAL_ALLOWED_ENVELOPE_SLOTS = ["inputs"] as const

export function PlaygroundTokenPathProvider({children}: {children: ReactNode}): ReactElement {
    // Global (unscoped) inputs source — aggregated port map across the
    // whole playground. Used as a fallback when no node context is wired.
    const inputs = useInputsSource(null)

    const sources = useMemo<Record<string, EnvelopeSource>>(
        () => ({[inputs.slot]: inputs}),
        [inputs],
    )

    const getSuggestions = useCallback<TokenPathSuggestionsGetter>(
        (prefix, query) => {
            if (prefix.length === 0) return []
            const [envelope, ...afterSlot] = prefix
            const source = sources[envelope]
            if (!source) return []
            return source.getSuggestions(afterSlot, query)
        },
        [sources],
    )

    return (
        <TokenPathSuggestionsProvider
            getSuggestions={getSuggestions}
            allowedEnvelopeSlots={GLOBAL_ALLOWED_ENVELOPE_SLOTS}
        >
            {children}
        </TokenPathSuggestionsProvider>
    )
}

/**
 * PlaygroundNodeTokenPathProvider — per-node scoped provider.
 *
 * Wrap this around any subtree that authors a specific node's prompt
 * (variants, evaluators). It:
 *   - resolves the node's position in the chain DAG via
 *     `nodeChainContextAtomFamily`,
 *   - scopes `inputs` to that node's own input-port schema (so e.g.
 *     an evaluator only sees its own declared inputs, not variants'),
 *   - adds `outputs` scoped to the upstream node's output-port schema
 *     when an upstream exists (depth > 0 nodes only),
 *   - overrides the global provider's allowed-slot list to match.
 *
 * For depth-0 nodes the scoped provider narrows inputs but keeps
 * `outputs` hidden — matches runtime reality (`completion_v0`/`chat_v0`
 * don't bind `outputs` into their template context).
 */
export function PlaygroundNodeTokenPathProvider({
    entityId,
    children,
}: {
    entityId: string
    children: ReactNode
}): ReactElement {
    const chainContext = useAtomValue(nodeChainContextAtomFamily(entityId))

    const inputs = useInputsSource(entityId)
    const outputs = useOutputsSource(chainContext.upstreamEntityId)

    const sources = useMemo<Record<string, EnvelopeSource>>(() => {
        const next: Record<string, EnvelopeSource> = {[inputs.slot]: inputs}
        // Only wire outputs when an upstream resolved. Keeps the
        // dispatcher from handing out `$.outputs.*` entries for
        // depth-0 nodes that have no upstream feed.
        if (chainContext.upstreamEntityId) next[outputs.slot] = outputs
        return next
    }, [inputs, outputs, chainContext.upstreamEntityId])

    const getSuggestions = useCallback<TokenPathSuggestionsGetter>(
        (prefix, query) => {
            if (prefix.length === 0) return []
            const [envelope, ...afterSlot] = prefix
            const source = sources[envelope]
            if (!source) return []
            return source.getSuggestions(afterSlot, query)
        },
        [sources],
    )

    return (
        <TokenPathSuggestionsProvider
            getSuggestions={getSuggestions}
            allowedEnvelopeSlots={chainContext.allowedSlots}
        >
            {children}
        </TokenPathSuggestionsProvider>
    )
}
