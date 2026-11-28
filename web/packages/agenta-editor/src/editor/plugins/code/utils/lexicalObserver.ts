import type {LexicalEditor} from "lexical"

/**
 * MutationObserver config used by Lexical internally.
 * Must match exactly so we reconnect with the same options.
 */
const LEXICAL_OBSERVER_OPTIONS: MutationObserverInit = {
    characterData: true,
    childList: true,
    subtree: true,
}

/**
 * Disconnect Lexical's internal MutationObserver before batch DOM mutations
 * (e.g., toggling CSS classes on hidden lines). Without this, Lexical sees
 * each DOM change as a content change and triggers reconciliation.
 *
 * We access `editor._observer` which is a private property, but Lexical itself
 * uses the same disconnect/reconnect pattern during its own reconciliation.
 */
export function disconnectLexicalObserver(editor: LexicalEditor): {reconnect: () => void} {
    const observer = (editor as unknown as {_observer: MutationObserver | null})._observer
    const root = editor.getRootElement()
    if (observer && root) {
        observer.disconnect()
        return {
            reconnect: () => {
                observer.observe(root, LEXICAL_OBSERVER_OPTIONS)
            },
        }
    }
    return {reconnect: () => {}}
}
