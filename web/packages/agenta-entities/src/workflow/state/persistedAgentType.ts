/**
 * Persisted `{workflowId: workflowType}` map so the playground knows agent-ness SYNCHRONOUSLY on a
 * cold reload — before the latest-revision query resolves — killing the eval-chrome / split-layout
 * flash. `playgroundEarlyAgentStateAtom` reads it as a fallback while the live query is pending; the
 * live query then rewrites the entry, so a type change self-heals within the session.
 *
 * Best-effort localStorage, bounded so it can't grow without limit. Values are the raw
 * `deriveWorkflowTypeFromRevision` output ("agent" | "chat" | "completion" | ...); consumers only
 * care whether it is `"agent"`.
 */

const STORAGE_KEY = "agenta:agent-type-by-app:1"
const MAX_ENTRIES = 500

type AgentTypeMap = Record<string, string>

function readMap(): AgentTypeMap {
    if (typeof window === "undefined") return {}
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === "object" ? (parsed as AgentTypeMap) : {}
    } catch {
        return {}
    }
}

export function readPersistedAgentType(workflowId: string): string | undefined {
    if (!workflowId) return undefined
    return readMap()[workflowId]
}

export function writePersistedAgentType(workflowId: string, type: string | null | undefined): void {
    if (typeof window === "undefined" || !workflowId || !type) return
    try {
        const map = readMap()
        if (map[workflowId] === type) return
        map[workflowId] = type
        // FIFO trim: JSON preserves string-key insertion order, so keep the most-recently-inserted.
        const keys = Object.keys(map)
        const bounded =
            keys.length > MAX_ENTRIES
                ? Object.fromEntries(
                      keys.slice(keys.length - MAX_ENTRIES).map((k) => [k, map[k]] as const),
                  )
                : map
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bounded))
    } catch {
        // quota / serialization — best-effort, ignore.
    }
}
