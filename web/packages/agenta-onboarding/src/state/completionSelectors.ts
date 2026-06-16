import type {Atom} from "jotai"

/**
 * Entity-driven completion (the slice of the deferred entity-driven-completion work that
 * makes onboarding completion derivable from real backend state).
 *
 * A widget item completes when EITHER an imperative event was recorded (the existing,
 * localStorage-backed path) OR a registered derived selector for one of its
 * `completionEventIds` reports `complete` (the truth-based path). The union means a derived
 * selector can never *un*-complete an item the user already finished imperatively.
 *
 * The selectors are REGISTERED by the consuming app (mirroring how @agenta/entities resolves
 * its user atoms via `setUserAtoms`). This keeps @agenta/onboarding domain-agnostic: it never
 * imports @agenta/entities, so the framework-free `/state` subpath that playground-ui's
 * ControlsBar imports just to fire an event does not drag the entities graph into its bundle.
 * The app (and the integration test) provides selectors that read real entity state.
 */

export interface CompletionState {
    /** True while the backing query is still resolving — the widget should not flash 0%. */
    loading: boolean
    /** True when the entity state proves the task is done. */
    complete: boolean
}

/** A jotai atom that derives a single event's completion from entity (or any) state. */
export type CompletionSelector = Atom<CompletionState>

/** Keyed by widget-item `completionEventId`. */
export type CompletionSelectorMap = Record<string, CompletionSelector>

let registeredSelectors: CompletionSelectorMap = {}

/**
 * Register entity-derived completion selectors. Call once at app initialization with selectors
 * that read the relevant entity atoms (e.g. `{testset_created: hasTestsetsSelector}`).
 */
export function setCompletionSelectors(selectors: CompletionSelectorMap): void {
    registeredSelectors = selectors
}

/** The currently registered selectors. Empty by default (pure imperative-event completion). */
export function getCompletionSelectors(): CompletionSelectorMap {
    return registeredSelectors
}

/** Reset the registry. Intended for tests. */
export function resetCompletionSelectors(): void {
    registeredSelectors = {}
}
