/**
 * Agent HTML apps — grant store (lane A).
 *
 * Remembers, per `${mountId}|${dir}`, which access level the user gave an app so reopening it in
 * the same tab does not ask again. In-memory `Map` first; mirrored to `sessionStorage` under
 * {@link GRANTS_STORAGE_KEY} so a reload keeps the answer for the tab's lifetime. Every storage
 * access is wrapped: private windows, blocked storage or a quota error must never break the
 * drive — the store then simply forgets on reload.
 */

import type {GrantLevel} from "./protocol"

export const GRANTS_STORAGE_KEY = "agenta:app-grants"

const grants = new Map<string, GrantLevel>()
let hydrated = false

const grantKey = (mountId: string, dir: string): string => `${mountId}|${dir}`

const isGrantLevel = (x: unknown): x is GrantLevel => x === "read" || x === "read-write"

const storage = (): Storage | null => {
    try {
        if (typeof sessionStorage === "undefined") return null
        return sessionStorage
    } catch {
        return null
    }
}

const hydrate = () => {
    if (hydrated) return
    hydrated = true
    try {
        const raw = storage()?.getItem(GRANTS_STORAGE_KEY)
        if (!raw) return
        const parsed: unknown = JSON.parse(raw)
        if (typeof parsed !== "object" || parsed === null) return
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (isGrantLevel(value)) grants.set(key, value)
        }
    } catch {
        // Corrupt or unreadable mirror: start empty.
    }
}

const persist = () => {
    try {
        const store = storage()
        if (!store) return
        if (grants.size === 0) {
            store.removeItem(GRANTS_STORAGE_KEY)
            return
        }
        store.setItem(GRANTS_STORAGE_KEY, JSON.stringify(Object.fromEntries(grants)))
    } catch {
        // Quota or blocked storage: the in-memory map is still authoritative for this page.
    }
}

/** The grant the user gave this app, or null when never asked. */
export function getGrant(mountId: string, dir: string): GrantLevel | null {
    hydrate()
    return grants.get(grantKey(mountId, dir)) ?? null
}

export function setGrant(mountId: string, dir: string, grant: GrantLevel): void {
    hydrate()
    grants.set(grantKey(mountId, dir), grant)
    persist()
}

/** Forget every grant (memory and the sessionStorage mirror). */
export function clearGrants(): void {
    hydrated = true
    grants.clear()
    persist()
}

/** Drop the in-memory map and re-read the mirror (another tab-local writer, or a test seed). */
export function reloadGrants(): void {
    grants.clear()
    hydrated = false
    hydrate()
}
