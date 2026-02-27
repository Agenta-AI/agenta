/**
 * Lexical update tag used for editor updates that only adjust syntax highlight nodes
 * without changing underlying code content.
 */
export const HIGHLIGHT_ONLY_UPDATE_TAG = "agenta:highlight-only-update"

/**
 * Lexical update tag used for updates originating from the Enter key behavior.
 * This allows heavy transforms to apply Enter-specific fast paths.
 */
export const ENTER_KEY_UPDATE_TAG = "agenta:enter-key-update"

/**
 * Lexical update tag for initial content loading / language switch.
 * Nodes are already tokenized by `createHighlightedNodes()`, so the
 * highlight transform can skip retokenization for this update cycle.
 */
export const INITIAL_CONTENT_UPDATE_TAG = "agenta:initial-content"

/**
 * Shared timing anchor for Enter key profiling.
 * Set by the Enter command handler; read by update listeners to
 * compute the time gap (reconciliation + transforms) between the
 * command completing and the listener firing.
 */
export let enterKeyTimestamp = 0
export function setEnterKeyTimestamp(ms: number) {
    enterKeyTimestamp = ms
}
