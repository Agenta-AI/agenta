/**
 * Agent HTML apps — grant store (lane A).
 *
 * Remembers, per `${mountId}|${dir}`, which access level the user gave an app so reopening it in
 * the same tab does not ask again. In-memory `Map` first; mirrored to `sessionStorage` under
 * {@link GRANTS_STORAGE_KEY} so a reload keeps the answer for the tab's lifetime. Every storage
 * access is wrapped: private windows, blocked storage or a quota error must never break the
 * drive — the store then simply forgets on reload.
 *
 * A record keeps BOTH levels: `level` is what the user chose, `asked` is what the manifest wanted
 * when they chose it. The pair is what makes "ask again when the app needs a higher level than
 * granted" possible without nagging: a user who was offered read-write and deliberately picked
 * read has `asked: "read-write"`, so reopening the same app never re-prompts, while an app whose
 * manifest LATER grows to read-write asks once, because `asked` is still `read`.
 */

import type {GrantLevel} from "./protocol"

export const GRANTS_STORAGE_KEY = "agenta:app-grants"

/** What the user chose, and the level the app was asking for at the time. */
export interface GrantRecord {
    level: GrantLevel
    asked: GrantLevel
}

const grants = new Map<string, GrantRecord>()
let hydrated = false

const grantKey = (mountId: string, dir: string): string => `${mountId}|${dir}`

const isGrantLevel = (x: unknown): x is GrantLevel => x === "read" || x === "read-write"

/**
 * Read one mirrored entry. Accepts the pre-record shape (a bare level string) so a tab that was
 * open across the upgrade keeps its grant instead of re-prompting; those entries read as
 * `asked === level`, which is the safe reading — an escalation still asks.
 */
const toRecord = (value: unknown): GrantRecord | null => {
    if (isGrantLevel(value)) return {level: value, asked: value}
    if (typeof value !== "object" || value === null) return null
    const {level, asked} = value as Record<string, unknown>
    if (!isGrantLevel(level)) return null
    return {level, asked: isGrantLevel(asked) ? asked : level}
}

/** True when `want` is strictly more access than `have`. */
export const exceedsGrant = (have: GrantLevel, want: GrantLevel): boolean =>
    have === "read" && want === "read-write"

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
            const record = toRecord(value)
            if (record) grants.set(key, record)
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
export function getGrant(mountId: string, dir: string): GrantRecord | null {
    hydrate()
    return grants.get(grantKey(mountId, dir)) ?? null
}

/**
 * Store the user's answer. `asked` is the level the app was requesting when the sheet was shown;
 * it defaults to the granted level, which makes a later escalation ask.
 */
export function setGrant(
    mountId: string,
    dir: string,
    grant: GrantLevel,
    asked: GrantLevel = grant,
): void {
    hydrate()
    grants.set(grantKey(mountId, dir), {level: grant, asked})
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
