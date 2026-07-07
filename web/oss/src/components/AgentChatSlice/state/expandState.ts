import type {UIMessage} from "ai"
import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

/**
 * Persisted expand/collapse state for in-message widgets (thoughts, tool rows, tool groups, long
 * errors), so an expanded widget survives a Virtuoso unmount when its row scrolls out of the window.
 *
 * Kept in a plain map (not an `atomFamily` of values) so the key set is enumerable and can be pruned:
 * entries are dropped when their owning message is gone (rewind / session eviction / close), which
 * keeps this bounded on long-lived sessions without ever resetting a currently-visible widget.
 */

// ── Key builders: the SINGLE source of truth for the key format, used by BOTH the widgets and the
// pruner below, so the two can never drift out of sync. ──
export const reasoningKey = (messageId: string, partIndex: number) =>
    `${messageId}::reason::${partIndex}`
export const errorKey = (messageId: string) => `${messageId}::error`
export const toolRowKey = (toolCallId: string) => `tool::row::${toolCallId}`
export const toolGroupKey = (toolCallId: string) => `tool::group::${toolCallId}`

/** The map IS the source of truth and the enumerable key set. `undefined` = follow the widget default. */
const expandedMapAtom = atom<Record<string, boolean>>({})

/** Scoped read: a widget re-renders only when ITS key flips, not on every other toggle. */
export const expandedValueAtomFamily = atomFamily((key: string) =>
    selectAtom(expandedMapAtom, (m) => m[key]),
)

/** Set one widget's expanded state. */
export const setExpandedAtom = atom(
    null,
    (get, set, {key, value}: {key: string; value: boolean}) => {
        set(expandedMapAtom, {...get(expandedMapAtom), [key]: value})
    },
)

const isToolType = (type: string | undefined) =>
    !!type && (type.startsWith("tool-") || type === "dynamic-tool")

/** Every expand key a set of messages can produce — same builders the widgets use. */
export const expandedKeysForMessages = (messages: UIMessage[]): Set<string> => {
    const keys = new Set<string>()
    for (const m of messages) {
        keys.add(errorKey(m.id))
        m.parts.forEach((p, i) => {
            const type = (p as {type?: string}).type
            if (type === "reasoning") keys.add(reasoningKey(m.id, i))
            if (isToolType(type)) {
                const toolCallId = (p as {toolCallId?: string}).toolCallId
                if (toolCallId) {
                    keys.add(toolRowKey(toolCallId))
                    keys.add(toolGroupKey(toolCallId))
                }
            }
        })
    }
    return keys
}

/** Drop entries (and their cached selector atoms) whose key isn't in `liveKeys` — call on settle with
 * the union of all open sessions' messages, so evicted/rewound widgets are cleaned up. */
export const pruneExpandedAtom = atom(null, (get, set, liveKeys: Set<string>) => {
    const cur = get(expandedMapAtom)
    let changed = false
    const next: Record<string, boolean> = {}
    for (const key in cur) {
        if (liveKeys.has(key)) {
            next[key] = cur[key]
        } else {
            changed = true
            expandedValueAtomFamily.remove(key)
        }
    }
    if (changed) set(expandedMapAtom, next)
})
