import {isPersistDebugEnabled, persistLog} from "./debug"
import {idbQueryStorage} from "./idbStorage"
import {catalogPersister, immutablePersister} from "./persisters"

let scheduled = false

/**
 * One idle-time sweep per session: drops entries past maxAge or with a stale
 * PERSIST_SCHEMA_VERSION buster. Safe to call from multiple mount points.
 */
export function schedulePersistedQueryGc(): void {
    if (scheduled || typeof window === "undefined") return
    scheduled = true

    const run = async () => {
        const before = isPersistDebugEnabled()
            ? (await idbQueryStorage.entries?.())?.length
            : undefined
        await immutablePersister.persisterGc().catch(() => undefined)
        await catalogPersister.persisterGc().catch(() => undefined)
        if (before !== undefined) {
            const after = (await idbQueryStorage.entries?.())?.length ?? 0
            persistLog("gc", `${before} entries → ${after} (${before - after} swept)`)
        }
    }

    if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(run, {timeout: 10_000})
    } else {
        setTimeout(run, 5_000)
    }
}
