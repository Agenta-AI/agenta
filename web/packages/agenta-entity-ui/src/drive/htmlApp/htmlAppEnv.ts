/** The seam a host or a story injects into HTML apps, and the grant store behind it. */
import {createContext, useSyncExternalStore} from "react"

import {
    getGrant,
    setGrant as storeGrant,
    subscribeGrants,
    type AppAccess,
    type GrantRecord,
    type HtmlAppHost,
    type HtmlAppHostOptions,
} from "@agenta/entities/drive"

import {type AssembleIo} from "./assemble"

export interface GrantStore {
    get: (mountId: string, dir: string) => GrantRecord | null
    set: (mountId: string, dir: string, record: GrantRecord) => void
    /** Called after any answer is stored; returns the unsubscribe. */
    subscribe: (listener: () => void) => () => void
}

const grantKey = (mountId: string, dir: string) => `${mountId}::${dir}`

/** An isolated in-memory store (stories, tests). */
export const createGrantStore = (): GrantStore => {
    const grants = new Map<string, GrantRecord>()
    const listeners = new Set<() => void>()
    return {
        get: (mountId, dir) => grants.get(grantKey(mountId, dir)) ?? null,
        set: (mountId, dir, record) => {
            grants.set(grantKey(mountId, dir), record)
            for (const listener of listeners) listener()
        },
        subscribe: (listener) => {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
    }
}

/** Per-user grants in localStorage: they hold across tabs and reloads, never across users. */
export const defaultGrants: GrantStore = {
    get: getGrant,
    set: storeGrant,
    subscribe: subscribeGrants,
}

/** What a stored level lets the app do here; write is capped to read where edits are off. */
export const effectiveAccess = (level: AppAccess | null, canEditMounts: boolean): AppAccess =>
    level === null ? "none" : level === "read-write" && !canEditMounts ? "read" : level

/** The stored level for an app folder, capped by `canEditMounts`; null when never answered. */
export function useGrantLevel(
    grants: GrantStore,
    mountId: string | null,
    dir: string,
    canEditMounts: boolean,
): AppAccess | null {
    // A string snapshot: the store hands out a fresh record object on every read.
    const stored = useSyncExternalStore(
        grants.subscribe,
        () => (mountId ? (grants.get(mountId, dir)?.level ?? "unset") : "unset"),
        () => "unset",
    )
    return stored === "unset" ? null : effectiveAccess(stored as AppAccess, canEditMounts)
}

export interface HtmlAppEnv {
    /** Bridge host factory; default `createHtmlAppHost` (stories inject the mock). */
    createHost?: (opts: HtmlAppHostOptions) => HtmlAppHost
    /** Mount io override (stories serve the mock's files); default: the real mount. */
    io?: AssembleIo | null
    /** Whether "Read and write files" is offered; default: the drive's upload gate. */
    canEditMounts?: boolean
    /** Kit stylesheet; default `KIT_CSS`. */
    kitCss?: string
    /** Bridge stub source; default `BRIDGE_STUB`. */
    bridgeStub?: string
    resolveTokens?: () => Record<string, string>
    grants?: GrantStore
    /** The positioned pane the access sheet is confined to; default: the whole page. */
    sheetContainer?: () => HTMLElement | null
    /** The toolbar slot the running app's controls portal into; default: a row above the app. */
    toolbarSlot?: HTMLElement | null
    /** Opens the host's ⋯ "File access…" setting for the running app. */
    openAccessSetting?: () => void
}

export const HtmlAppEnvContext = createContext<HtmlAppEnv>({})
