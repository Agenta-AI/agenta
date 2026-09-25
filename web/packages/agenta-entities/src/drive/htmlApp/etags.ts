/**
 * Agent HTML apps — per-path etag cache (lane A).
 *
 * The bridge's implicit If-Match: the host remembers the etag it last handed the app for a path
 * (read / list / stat / successful write) and sends it on the next write / remove of that path.
 * One cache per host instance; keys are app-relative normalised paths. `undefined` from `get`
 * means "never seen" — the write goes out unconditionally.
 */

export interface EtagCache {
    /** The etag last returned for `path`, or undefined when unknown. */
    get(path: string): string | undefined
    /** Remember an etag; a null/undefined etag forgets the path (the server gave us nothing). */
    set(path: string, etag: string | null | undefined): void
    /** Forget these paths (a file changed underneath the app, or was removed). */
    invalidate(paths: readonly string[]): void
    clear(): void
    readonly size: number
    /** Snapshot for tests and debugging. */
    entries(): [string, string][]
}

export function createEtagCache(): EtagCache {
    const etags = new Map<string, string>()
    return {
        get(path) {
            return etags.get(path)
        },
        set(path, etag) {
            if (typeof etag === "string") etags.set(path, etag)
            else etags.delete(path)
        },
        invalidate(paths) {
            for (const path of paths) etags.delete(path)
        },
        clear() {
            etags.clear()
        },
        get size() {
            return etags.size
        },
        entries() {
            return [...etags.entries()]
        },
    }
}
