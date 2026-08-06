import type {TokenPathSuggestion} from "@agenta/ui/editor"

/**
 * One envelope slot's contribution to the prompt editor's JSONPath
 * typeahead. Each slot (inputs, outputs, parameters, testcase, trace,
 * revision, ...) has its own source that owns:
 *
 *   - the data it pulls from (schema maps, testcase entities, workflow
 *     parameters, observed traces, ...)
 *   - the path depth it supports (some stay shallow, `trace` goes deep)
 *   - the hint tag shown alongside each suggestion
 *
 * Sources self-subscribe via React hooks — see `UseEnvelopeSource` —
 * so each source owns its atom dependencies without the dispatcher
 * having to thread props through.
 */
export interface EnvelopeSource {
    /** Envelope slot name, e.g. "inputs", "outputs", "testcase". */
    readonly slot: string

    /**
     * Produce suggestions for a path position within this slot.
     *
     * `afterSlot` is the segment list BEYOND the slot prefix. For
     * `{{$.inputs.arda.te}}` the plugin passes `afterSlot=["arda"]`,
     * `query="te"`. For `{{$.trace.attributes.ag.data.i}}` it passes
     * `afterSlot=["attributes", "ag", "data"]`, `query="i"`.
     *
     * `afterSlot.length` indicates depth within the envelope:
     *   0 → `{{$.<slot>.<here>}}` (suggest root names)
     *   1 → `{{$.<slot>.<root>.<here>}}`
     *   N → deeper walks
     *
     * Returning `[]` cedes this position to the plugin's
     * previously-seen-tokens fallback.
     */
    getSuggestions(afterSlot: string[], query: string): TokenPathSuggestion[]
}

/**
 * Each source is implemented as a React hook returning a stable source
 * object. The hook is where the source subscribes to whatever atoms it
 * needs; the memoized output is what the dispatcher consumes.
 */
export type UseEnvelopeSource = () => EnvelopeSource
