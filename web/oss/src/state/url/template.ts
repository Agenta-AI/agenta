import {atom, getDefaultStore} from "jotai"

import {AGENT_TEMPLATES} from "../../components/pages/agent-home/assets/templates"
import type {AgentTemplate} from "../../components/pages/agent-home/assets/templates"

// Capture / storage / TTL / validation / claim for a website template deep-link. Kept out of
// auth.ts so that module does not become a registry of unrelated features; auth.ts only calls in.

const hasWindow = () => typeof window !== "undefined"

export const TEMPLATE_URL_PARAM = "template"
const TEMPLATE_STORAGE_KEY = "pendingTemplate"
const TEMPLATE_CLAIM_KEY = "pendingTemplateClaim"

// A real signup can include email verification and a provider round-trip, so the key must outlive
// several minutes; thirty is comfortably longer than any real signup and short enough that a
// forgotten key cannot create an agent later.
export const TEMPLATE_TTL_MS = 30 * 60 * 1000

export interface PendingTemplate {
    key: string
    capturedAt: number
}

export const activeTemplateAtom = atom<string | null>(null)

const validTemplateKeys = new Set(AGENT_TEMPLATES.map((template) => template.key))

/** Exact-match lookup against the app registry; an unknown or stale key resolves to undefined. */
export const resolveTemplate = (key: string | null | undefined): AgentTemplate | undefined => {
    if (!key) return undefined
    return AGENT_TEMPLATES.find((template) => template.key === key)
}

export const isValidTemplateKey = (key: string | null | undefined): boolean =>
    !!key && validTemplateKeys.has(key)

export const parseTemplateFromUrl = (url: URL): string | null => {
    const key = url.searchParams.get(TEMPLATE_URL_PARAM)?.trim()
    return key ? key : null
}

export const readTemplateFromStorage = (): PendingTemplate | null => {
    if (!hasWindow()) return null
    try {
        const raw = window.localStorage.getItem(TEMPLATE_STORAGE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (
            parsed &&
            typeof parsed.key === "string" &&
            parsed.key.trim() &&
            typeof parsed.capturedAt === "number"
        ) {
            // Expiry is measured from capture time, so a key that outlives its window drops itself.
            if (Date.now() - parsed.capturedAt > TEMPLATE_TTL_MS) {
                window.localStorage.removeItem(TEMPLATE_STORAGE_KEY)
                return null
            }
            return {key: parsed.key.trim(), capturedAt: parsed.capturedAt}
        }
    } catch (error) {
        console.error("Failed to read pending template from storage:", error)
    }
    return null
}

export const persistTemplateToStorage = (pending: PendingTemplate | null) => {
    if (!hasWindow()) return
    try {
        if (pending && pending.key) {
            window.localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(pending))
        } else {
            window.localStorage.removeItem(TEMPLATE_STORAGE_KEY)
        }
    } catch (error) {
        console.error("Failed to persist pending template to storage:", error)
    }
}

/**
 * Capture the template key from the URL, mirroring the invite capture, and mirror it into the
 * shared atom. The capture time is stamped once, on the first sighting of a key, so the TTL
 * measures from arrival and a key that survives many navigations still ages. This also runs on a
 * regional host after a region redirect: the query string is preserved across the switch but
 * localStorage is not shared between hosts, so the key is re-saved under the host the user lands on.
 */
export const captureTemplateFromUrl = (url: URL): string | null => {
    const store = getDefaultStore()
    const urlKey = parseTemplateFromUrl(url)

    if (urlKey) {
        const stored = readTemplateFromStorage()
        if (!stored || stored.key !== urlKey) {
            persistTemplateToStorage({key: urlKey, capturedAt: Date.now()})
        }
        store.set(activeTemplateAtom, urlKey)
        return urlKey
    }

    const stored = readTemplateFromStorage()
    store.set(activeTemplateAtom, stored?.key ?? null)
    return stored?.key ?? null
}

const TEMPLATE_URL_PARAMS = [TEMPLATE_URL_PARAM]

/**
 * Fully forget a pending template: the atom, storage, the claim flag, and the `template` query
 * param. Stripping the URL param matters for the same reason it does for invites — the capture
 * re-reads the URL on every navigation and would otherwise resurrect the key from a stale param.
 */
export const clearTemplate = () => {
    const store = getDefaultStore()
    store.set(activeTemplateAtom, null)
    persistTemplateToStorage(null)

    if (!hasWindow()) return
    try {
        window.localStorage.removeItem(TEMPLATE_CLAIM_KEY)
    } catch (error) {
        console.error("Failed to clear template claim:", error)
    }
    try {
        const url = new URL(window.location.href)
        let changed = false
        TEMPLATE_URL_PARAMS.forEach((param) => {
            if (url.searchParams.has(param)) {
                url.searchParams.delete(param)
                changed = true
            }
        })
        if (changed) {
            window.history.replaceState(
                window.history.state,
                "",
                `${url.pathname}${url.search}${url.hash}`,
            )
        }
    } catch (error) {
        console.error("Failed to clear template params from URL:", error)
    }
}

/**
 * At-most-once claim. localStorage has no atomic compare-and-set, so two tabs could both read a
 * key as unclaimed and both create. The Web Locks API serialises the read-claim-write across
 * same-origin tabs, so only one caller can move the key from unclaimed to claimed. Where the API
 * is unavailable the claim degrades to a best-effort local-storage compare-and-set, and in that
 * narrow case the guarantee softens from at-most-once to best-effort. Returns true only for the
 * caller that wins the claim.
 */
export const claimTemplate = async (key: string): Promise<boolean> => {
    if (!hasWindow()) return false

    const compareAndSet = (): boolean => {
        try {
            if (window.localStorage.getItem(TEMPLATE_CLAIM_KEY) === key) return false
            window.localStorage.setItem(TEMPLATE_CLAIM_KEY, key)
            return true
        } catch (error) {
            console.error("Failed to claim pending template:", error)
            return false
        }
    }

    const locks = (navigator as Navigator & {locks?: LockManager})?.locks
    if (locks?.request) {
        try {
            return await locks.request(`pendingTemplate:${key}`, compareAndSet)
        } catch (error) {
            console.error("Web Locks claim failed, falling back to best-effort:", error)
            return compareAndSet()
        }
    }
    return compareAndSet()
}
