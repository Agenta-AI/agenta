/**
 * Agent HTML apps — the access gate both hosts share: what the app may touch now, and the one
 * question at a time that raises it when a call needs more.
 */
import type {AppAccess, GrantLevel} from "./protocol"

/** True when `have` lets a call that needs `need` through. */
export const coversAccess = (have: AppAccess, need: GrantLevel): boolean =>
    have === "read-write" || (have === "read" && need === "read")

export interface AccessGate {
    readonly level: AppAccess
    /** Change the level now (a menu choice, an answer stored elsewhere). */
    set(next: AppAccess): void
    /** Resolves once a call needing `need` is covered or has its answer. */
    settle(need: GrantLevel): Promise<void>
}

export function createAccessGate(opts: {
    grant: AppAccess
    requestAccess?: (need: GrantLevel) => Promise<AppAccess>
    onChange: (next: AppAccess) => void
}): AccessGate {
    let level = opts.grant
    let queue: Promise<void> = Promise.resolve()
    const set = (next: AppAccess) => {
        if (next === level) return
        level = next
        opts.onChange(next)
    }
    return {
        get level() {
            return level
        },
        set,
        settle(need) {
            const ask = opts.requestAccess
            if (!ask || coversAccess(level, need)) return Promise.resolve()
            // Queued: calls waiting on an open question share its answer before asking again.
            queue = queue.then(async () => {
                if (coversAccess(level, need)) return
                set(await ask(need).catch(() => level))
            })
            return queue
        },
    }
}
