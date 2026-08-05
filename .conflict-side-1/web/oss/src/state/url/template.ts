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

interface TemplateClaim extends PendingTemplate {
    status: "claimed" | "completed"
    updatedAt: number
}

export const activeTemplateAtom = atom<PendingTemplate | null>(null)

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

const parsePendingTemplate = (raw: string | null): PendingTemplate | null => {
    if (!raw) return null
    try {
        const parsed = JSON.parse(raw)
        if (
            parsed &&
            typeof parsed.key === "string" &&
            parsed.key.trim() &&
            typeof parsed.capturedAt === "number"
        ) {
            return {key: parsed.key.trim(), capturedAt: parsed.capturedAt}
        }
    } catch (error) {
        console.error("Failed to parse pending template from storage:", error)
    }
    return null
}

const readStoredTemplateRecord = (): PendingTemplate | null => {
    if (!hasWindow()) return null
    try {
        return parsePendingTemplate(window.localStorage.getItem(TEMPLATE_STORAGE_KEY))
    } catch (error) {
        console.error("Failed to read pending template from storage:", error)
        return null
    }
}

const isExpired = (pending: PendingTemplate): boolean =>
    Date.now() - pending.capturedAt > TEMPLATE_TTL_MS

const samePendingTemplate = (
    left: PendingTemplate | null,
    right: PendingTemplate | null,
): boolean => !!left && !!right && left.key === right.key && left.capturedAt === right.capturedAt

const removeTemplateParamFromCurrentUrl = (expectedKey?: string) => {
    if (!hasWindow()) return
    try {
        const url = new URL(window.location.href)
        if (expectedKey && parseTemplateFromUrl(url) !== expectedKey) return
        if (!url.searchParams.has(TEMPLATE_URL_PARAM)) return
        url.searchParams.delete(TEMPLATE_URL_PARAM)
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash)
    } catch (error) {
        console.error("Failed to clear template params from URL:", error)
    }
}

export const readTemplateFromStorage = (): PendingTemplate | null => {
    const pending = readStoredTemplateRecord()
    if (!pending) return null
    if (!isExpired(pending)) return pending

    persistTemplateToStorage(null)
    removeTemplateParamFromCurrentUrl(pending.key)
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
    const storedRecord = readStoredTemplateRecord()

    if (storedRecord && isExpired(storedRecord)) {
        persistTemplateToStorage(null)
        if (urlKey === storedRecord.key) {
            removeTemplateParamFromCurrentUrl(storedRecord.key)
            store.set(activeTemplateAtom, null)
            return null
        }
    }

    if (urlKey) {
        const stored = storedRecord && !isExpired(storedRecord) ? storedRecord : null
        const pending = stored?.key === urlKey ? stored : {key: urlKey, capturedAt: Date.now()}
        if (!samePendingTemplate(stored, pending)) persistTemplateToStorage(pending)
        store.set(activeTemplateAtom, pending)
        return urlKey
    }

    const stored = readTemplateFromStorage()
    store.set(activeTemplateAtom, stored)
    return stored?.key ?? null
}

/**
 * Fully forget a pending template and its URL parameter. The completed claim is deliberately
 * retained for a bounded time so a late tab that captured the same generation cannot recreate it.
 * Passing the expected generation prevents an older async consumer from clearing a newer visit.
 */
export const clearTemplate = (expected?: PendingTemplate) => {
    const store = getDefaultStore()
    const stored = readStoredTemplateRecord()
    const shouldClear = !expected || samePendingTemplate(stored, expected)
    if (shouldClear) persistTemplateToStorage(null)

    const active = store.get(activeTemplateAtom)
    if (!expected || samePendingTemplate(active, expected)) store.set(activeTemplateAtom, null)

    if (shouldClear) removeTemplateParamFromCurrentUrl(expected?.key)
}

const readTemplateClaim = (): TemplateClaim | null => {
    if (!hasWindow()) return null
    try {
        const raw = window.localStorage.getItem(TEMPLATE_CLAIM_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (
            parsed &&
            typeof parsed.key === "string" &&
            typeof parsed.capturedAt === "number" &&
            (parsed.status === "claimed" || parsed.status === "completed") &&
            typeof parsed.updatedAt === "number"
        ) {
            if (Date.now() - parsed.updatedAt <= TEMPLATE_TTL_MS) return parsed as TemplateClaim
        }
        window.localStorage.removeItem(TEMPLATE_CLAIM_KEY)
    } catch (error) {
        console.error("Failed to read template claim:", error)
    }
    return null
}

const writeTemplateClaim = (claim: TemplateClaim) => {
    window.localStorage.setItem(TEMPLATE_CLAIM_KEY, JSON.stringify(claim))
}

/**
 * At-most-once claim. localStorage has no atomic compare-and-set, so two tabs could both read a
 * key as unclaimed and both create. The Web Locks API serialises the read-claim-write across
 * same-origin tabs, so only one caller can move the key from unclaimed to claimed. Where the API
 * is unavailable the claim degrades to a best-effort local-storage compare-and-set, and in that
 * narrow case the guarantee softens from at-most-once to best-effort. Returns true only for the
 * caller that wins the claim.
 */
export const claimTemplate = async (pending: PendingTemplate): Promise<boolean> => {
    if (!hasWindow()) return false

    const compareAndSet = (): boolean => {
        try {
            const currentPending = readStoredTemplateRecord()
            if (!samePendingTemplate(currentPending, pending) || isExpired(pending)) return false

            const existingClaim = readTemplateClaim()
            if (samePendingTemplate(existingClaim, pending)) return false

            writeTemplateClaim({...pending, status: "claimed", updatedAt: Date.now()})
            return true
        } catch (error) {
            console.error("Failed to claim pending template:", error)
            return false
        }
    }

    const locks = (navigator as Navigator & {locks?: LockManager})?.locks
    if (locks?.request) {
        try {
            return await locks.request("pendingTemplate:" + pending.key, compareAndSet)
        } catch (error) {
            console.error("Web Locks claim failed, falling back to best-effort:", error)
            return compareAndSet()
        }
    }
    return compareAndSet()
}

/** Keep the winning generation visible to late tabs until its bounded claim expires. */
export const completeTemplateClaim = async (pending: PendingTemplate): Promise<void> => {
    if (!hasWindow()) return

    const complete = () => {
        try {
            const claim = readTemplateClaim()
            if (!claim || !samePendingTemplate(claim, pending)) return
            writeTemplateClaim({...claim, status: "completed", updatedAt: Date.now()})
        } catch (error) {
            console.error("Failed to complete template claim:", error)
        }
    }

    const locks = (navigator as Navigator & {locks?: LockManager})?.locks
    if (locks?.request) {
        try {
            await locks.request("pendingTemplate:" + pending.key, complete)
            return
        } catch (error) {
            console.error("Web Locks completion failed, falling back to best-effort:", error)
        }
    }
    complete()
}
