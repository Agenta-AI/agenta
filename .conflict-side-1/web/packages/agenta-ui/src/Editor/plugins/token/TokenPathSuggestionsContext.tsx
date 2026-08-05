import {createContext, useContext, useMemo, type ReactElement, type ReactNode} from "react"

/**
 * A single path-suggestion entry contributed by a consumer (e.g. the
 * playground provides entries derived from port schemas + testcase keys).
 */
export interface TokenPathSuggestion {
    /** Displayed as the next-segment option (e.g. "arda", "test254"). */
    label: string
    /**
     * Optional small hint tag rendered alongside the label.
     * Example values: "input", "output", "schema", "seen".
     */
    hint?: string
}

/**
 * Consumer-supplied callback that returns next-segment candidates for a
 * given path position. The plugin calls it whenever the user is typing
 * inside a `{{$.*}}` token.
 *
 * `prefix` — segments already committed before the current input cursor.
 *            E.g. for `{{$.inputs.arda.te}}` the plugin passes `["inputs", "arda"]`.
 * `query`  — the in-progress segment being typed ("te" in the example).
 *
 * Return values are *merged* with the plugin's baseline suggestions
 * (envelope slots at depth 0, previously-seen tokens otherwise). The
 * consumer doesn't need to include those.
 */
export type TokenPathSuggestionsGetter = (prefix: string[], query: string) => TokenPathSuggestion[]

/** Full context value — extend here when adding new knobs. */
interface TokenPathSuggestionsContextValue {
    getSuggestions: TokenPathSuggestionsGetter
    /**
     * Optional subset of envelope slots to surface at depth 0.
     * When omitted, the plugin falls back to the full canonical list
     * (`KNOWN_ENVELOPE_SLOTS`). Consumers use this to hide envelope
     * options that aren't wired yet — e.g. playground currently
     * restricts to `["inputs", "outputs"]` while testcase / parameters
     * / trace / revision sources are incomplete.
     */
    allowedEnvelopeSlots?: readonly string[]
}

const TokenPathSuggestionsContext = createContext<TokenPathSuggestionsContextValue | null>(null)

export interface TokenPathSuggestionsProviderProps {
    getSuggestions: TokenPathSuggestionsGetter
    /** Optional subset of envelope slots to show at depth 0. */
    allowedEnvelopeSlots?: readonly string[]
    children: ReactNode
}

/**
 * Provider for contextual path suggestions in the prompt editor's token
 * typeahead. Intended to be wrapped around any editor surface where
 * richer suggestions are available (the playground provides this; generic
 * editors fall back to DOM-mined previously-seen tokens).
 */
export function TokenPathSuggestionsProvider({
    getSuggestions,
    allowedEnvelopeSlots,
    children,
}: TokenPathSuggestionsProviderProps): ReactElement {
    const value = useMemo<TokenPathSuggestionsContextValue>(
        () => ({getSuggestions, allowedEnvelopeSlots}),
        [getSuggestions, allowedEnvelopeSlots],
    )
    return (
        <TokenPathSuggestionsContext.Provider value={value}>
            {children}
        </TokenPathSuggestionsContext.Provider>
    )
}

/** Returns the provider's getter, or `null` when no provider is mounted. */
export function useTokenPathSuggestions(): TokenPathSuggestionsGetter | null {
    return useContext(TokenPathSuggestionsContext)?.getSuggestions ?? null
}

/**
 * Full context accessor — used by the plugin to read both the
 * suggestions getter and optional settings like `allowedEnvelopeSlots`.
 * Most consumers should use `useTokenPathSuggestions` instead.
 */
export function useTokenPathSuggestionsContext(): TokenPathSuggestionsContextValue | null {
    return useContext(TokenPathSuggestionsContext)
}
