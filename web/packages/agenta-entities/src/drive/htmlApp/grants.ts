/** Agent HTML apps — per-user file-access answers, kept in localStorage per mount and folder. */

import {ACTIVE_USER_ID_KEY, userSettingsKey} from "@agenta/shared/state"

import type {AppAccess} from "./protocol"

/** The per-user settings key the map is stored under. */
export const grantsStorageKey = (userId: string): string => userSettingsKey(userId, "app-grants")

/** What the user answered for one app folder. */
export interface GrantRecord {
    /** The access the user gave; null while the read question is unanswered. */
    level: AppAccess | null
    /** The user refused to let the app change files; its writes fail without asking. */
    writeRefused: boolean
}

const memory = new Map<string, Map<string, GrantRecord>>()
const listeners = new Set<() => void>()

const grantKey = (mountId: string, dir: string): string => `${mountId}|${dir}`

const isAppAccess = (x: unknown): x is AppAccess =>
    x === "none" || x === "read" || x === "read-write"

/** Read one stored entry; anything malformed reads as unanswered. */
const toRecord = (value: unknown): GrantRecord | null => {
    if (typeof value !== "object" || value === null) return null
    const {level, writeRefused} = value as Record<string, unknown>
    if (level !== null && !isAppAccess(level)) return null
    return {level, writeRefused: writeRefused === true}
}

const storage = (): Storage | null => {
    try {
        if (typeof localStorage === "undefined") return null
        return localStorage
    } catch {
        return null
    }
}

const activeUserId = (): string | null => {
    try {
        return storage()?.getItem(ACTIVE_USER_ID_KEY) || null
    } catch {
        return null
    }
}

/** The current user's map: storage first (so another tab's answer is seen), memory otherwise. */
const readMap = (userId: string | null): Map<string, GrantRecord> => {
    const scope = userId ?? ""
    const store = userId ? storage() : null
    if (userId && store) {
        try {
            const raw = store.getItem(grantsStorageKey(userId))
            const parsed: unknown = raw ? JSON.parse(raw) : {}
            if (typeof parsed === "object" && parsed !== null) {
                const map = new Map<string, GrantRecord>()
                for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
                    const record = toRecord(value)
                    if (record) map.set(key, record)
                }
                memory.set(scope, map)
                return map
            }
        } catch {
            // Corrupt or unreadable entry: fall back to what this page remembers.
        }
    }
    let map = memory.get(scope)
    if (!map) {
        map = new Map()
        memory.set(scope, map)
    }
    return map
}

const writeMap = (userId: string | null, map: Map<string, GrantRecord>) => {
    memory.set(userId ?? "", map)
    if (!userId) return
    try {
        const store = storage()
        if (!store) return
        const key = grantsStorageKey(userId)
        if (map.size === 0) store.removeItem(key)
        else store.setItem(key, JSON.stringify(Object.fromEntries(map)))
    } catch {
        // Quota or blocked storage: memory still holds the answer for this page.
    }
}

/** What the user answered for this app, or null when never asked. */
export function getGrant(mountId: string, dir: string): GrantRecord | null {
    return readMap(activeUserId()).get(grantKey(mountId, dir)) ?? null
}

/** Store the user's answer for this app. */
export function setGrant(mountId: string, dir: string, record: GrantRecord): void {
    const userId = activeUserId()
    const map = new Map(readMap(userId))
    map.set(grantKey(mountId, dir), record)
    writeMap(userId, map)
    for (const listener of listeners) listener()
}

/** Called after any answer is stored on this page; returns the unsubscribe. */
export function subscribeGrants(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

/** Forget the current user's answers (storage and memory). */
export function clearGrants(): void {
    writeMap(activeUserId(), new Map())
    memory.clear()
    for (const listener of listeners) listener()
}
