/**
 * Client-side id generation.
 *
 * `crypto.randomUUID` exists only in a SECURE context. The dev stack is served over plain HTTP,
 * where it is `undefined` — every unguarded call threw `crypto.randomUUID is not a function` and
 * took the whole screen down, because these ids are minted during render.
 *
 * Ids from here are React keys and client-minted session ids, never anything security-bearing, so
 * the fallback only has to be unique within a tab.
 */
export function newId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID()
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
