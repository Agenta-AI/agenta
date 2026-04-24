/**
 * PlaygroundTokenPathProvider
 *
 * Feeds the prompt editor's JSONPath typeahead with suggestions via a
 * per-envelope source abstraction. Each source is a self-subscribing
 * React hook that owns its data access (port schemas, observed
 * testcases, workflow parameters, ...) and its depth policy.
 *
 * Adding a new envelope = add a source file + register it here. The
 * dispatcher itself stays trivial.
 *
 * See `types.ts` for the source contract and `sources/` for the
 * per-envelope implementations.
 */

import {useCallback, useMemo, type ReactElement, type ReactNode} from "react"

import {TokenPathSuggestionsProvider, type TokenPathSuggestionsGetter} from "@agenta/ui/editor"

import {useInputsSource} from "./sources/inputs"
import {useOutputsSource} from "./sources/outputs"
// import {useParametersSource} from "./sources/parameters"
// import {useTestcaseSource} from "./sources/testcase"
import type {EnvelopeSource} from "./types"

/**
 * Envelope slots currently offered in the `{{$.<here>}}` suggestion
 * list. The testcase / parameters / trace / revision slots stay off
 * until their sources are production-ready — their backing sources are
 * written (`sources/testcase.ts`, `sources/parameters.ts`) but not
 * wired below, and the plugin hides them at depth 0 via this list.
 */
const ALLOWED_ENVELOPE_SLOTS = ["inputs", "outputs"] as const

export function PlaygroundTokenPathProvider({children}: {children: ReactNode}): ReactElement {
    // Each source self-subscribes to the atoms it needs.
    const inputs = useInputsSource()
    const outputs = useOutputsSource()
    // Disabled — see ALLOWED_ENVELOPE_SLOTS note above. Re-enable by
    // un-commenting the hook call AND adding the slot to both the
    // `sources` record and `ALLOWED_ENVELOPE_SLOTS`.
    // const testcase = useTestcaseSource()
    // const parameters = useParametersSource()

    const sources = useMemo<Record<string, EnvelopeSource>>(
        () => ({
            [inputs.slot]: inputs,
            [outputs.slot]: outputs,
        }),
        [inputs, outputs],
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
            allowedEnvelopeSlots={ALLOWED_ENVELOPE_SLOTS}
        >
            {children}
        </TokenPathSuggestionsProvider>
    )
}
