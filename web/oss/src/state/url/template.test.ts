import type {AgentStarterTemplate} from "@agenta/entities/workflow"
import {getDefaultStore} from "jotai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    activeTemplateAtom,
    captureTemplateFromUrl,
    claimTemplate,
    clearTemplate,
    completeTemplateClaim,
    parseTemplateFromUrl,
    pendingTemplateDecision,
    persistTemplateToStorage,
    readTemplateFromStorage,
    TEMPLATE_TTL_MS,
} from "./template"

// Capture, storage and claim never read the catalog, so any key string works here.
const KNOWN_KEY = "pr-reviewer"

// Only the key matters to the decision; the rest of the card is irrelevant to these tests.
const KNOWN_TEMPLATE = {key: KNOWN_KEY, name: "PR reviewer"} as AgentStarterTemplate

class FakeStorage {
    private map = new Map<string, string>()
    getItem(key: string) {
        return this.map.has(key) ? (this.map.get(key) as string) : null
    }
    setItem(key: string, value: string) {
        this.map.set(key, String(value))
    }
    removeItem(key: string) {
        this.map.delete(key)
    }
    clear() {
        this.map.clear()
    }
}

const installWindow = (href: string, locks?: unknown) => {
    const storage = new FakeStorage()
    const state = {} as unknown
    const replaceState = vi.fn((_s: unknown, _t: string, url: string) => {
        fakeWindow.location.href = new URL(url, "https://cloud.agenta.ai").href
    })
    const fakeWindow = {
        localStorage: storage,
        location: {href: new URL(href, "https://cloud.agenta.ai").href},
        history: {state, replaceState},
    }
    vi.stubGlobal("window", fakeWindow)
    vi.stubGlobal("navigator", locks ? {locks} : {})
    return fakeWindow
}

const capturePending = (): {key: string; capturedAt: number} => {
    captureTemplateFromUrl(new URL("https://cloud.agenta.ai/?template=" + KNOWN_KEY))
    const pending = getDefaultStore().get(activeTemplateAtom)
    if (!pending) throw new Error("Expected a pending template")
    return pending
}

beforeEach(() => {
    getDefaultStore().set(activeTemplateAtom, null)
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe("parseTemplateFromUrl", () => {
    it("returns the key when the template param is present", () => {
        const url = new URL("https://cloud.agenta.ai/?template=pr-reviewer")
        expect(parseTemplateFromUrl(url)).toBe("pr-reviewer")
    })

    it("returns null when the template param is absent", () => {
        expect(parseTemplateFromUrl(new URL("https://cloud.agenta.ai/"))).toBeNull()
    })

    it("trims surrounding whitespace and treats blank as absent", () => {
        expect(parseTemplateFromUrl(new URL("https://cloud.agenta.ai/?template=%20%20"))).toBeNull()
    })
})

describe("pendingTemplateDecision (catalog validation at consume time)", () => {
    it("waits, keeping the key, while the catalog is loading", () => {
        expect(pendingTemplateDecision({status: "pending"})).toEqual({
            action: "wait",
            reason: "pending",
        })
    })

    it("waits, keeping the key, when the catalog read failed", () => {
        expect(pendingTemplateDecision({status: "error"})).toEqual({
            action: "wait",
            reason: "error",
        })
    })

    it("discards a key the loaded catalog does not have, without falling back", () => {
        expect(pendingTemplateDecision({status: "missing"})).toEqual({action: "discard"})
    })

    it("consumes a key the catalog has, with that exact template", () => {
        const decision = pendingTemplateDecision({status: "found", template: KNOWN_TEMPLATE})
        expect(decision).toEqual({action: "consume", template: KNOWN_TEMPLATE})
    })

    it("keeps a captured key in storage and the atom while the catalog is pending", () => {
        installWindow("/?template=" + KNOWN_KEY)
        const pending = capturePending()
        const decision = pendingTemplateDecision({status: "pending"})
        // The consumer only clears on "discard"; a "wait" leaves the capture untouched.
        if (decision.action === "discard") clearTemplate(pending)
        expect(readTemplateFromStorage()).toEqual(pending)
        expect(getDefaultStore().get(activeTemplateAtom)).toEqual(pending)
    })

    it("clears a captured key once the catalog confirms it is missing", () => {
        const win = installWindow("/?template=not-a-real-template")
        captureTemplateFromUrl(new URL("https://cloud.agenta.ai/?template=not-a-real-template"))
        const pending = getDefaultStore().get(activeTemplateAtom)
        if (!pending) throw new Error("Expected a pending template")
        const decision = pendingTemplateDecision({status: "missing"})
        if (decision.action === "discard") clearTemplate(pending)
        expect(readTemplateFromStorage()).toBeNull()
        expect(getDefaultStore().get(activeTemplateAtom)).toBeNull()
        expect(win.location.href).not.toContain("template=")
    })

    it("lets a found key proceed to the at-most-once claim", async () => {
        installWindow("/")
        const pending = capturePending()
        const decision = pendingTemplateDecision({status: "found", template: KNOWN_TEMPLATE})
        expect(decision.action).toBe("consume")
        expect(await claimTemplate(pending)).toBe(true)
    })
})

describe("storage round-trip and TTL", () => {
    it("persists then reads back the key", () => {
        installWindow("/")
        persistTemplateToStorage({key: KNOWN_KEY, capturedAt: Date.now()})
        expect(readTemplateFromStorage()?.key).toBe(KNOWN_KEY)
    })

    it("treats a key past its expiry as absent and removes it", () => {
        installWindow("/")
        persistTemplateToStorage({key: KNOWN_KEY, capturedAt: Date.now() - TEMPLATE_TTL_MS - 1})
        expect(readTemplateFromStorage()).toBeNull()
        // A second read confirms the expired entry was purged, not just filtered.
        expect(readTemplateFromStorage()).toBeNull()
    })
})

describe("captureTemplateFromUrl", () => {
    it("captures the key from the URL and mirrors it into the atom", () => {
        installWindow(`/?template=${KNOWN_KEY}`)
        const url = new URL(`https://cloud.agenta.ai/?template=${KNOWN_KEY}`)
        expect(captureTemplateFromUrl(url)).toBe(KNOWN_KEY)
        expect(getDefaultStore().get(activeTemplateAtom)?.key).toBe(KNOWN_KEY)
        expect(readTemplateFromStorage()?.key).toBe(KNOWN_KEY)
    })

    it("stamps the capture time once and does not reset it on a later capture", () => {
        installWindow(`/?template=${KNOWN_KEY}`)
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
        const url = new URL(`https://cloud.agenta.ai/?template=${KNOWN_KEY}`)
        captureTemplateFromUrl(url)
        const first = readTemplateFromStorage()?.capturedAt

        vi.setSystemTime(new Date("2026-01-01T00:05:00Z"))
        captureTemplateFromUrl(url)
        expect(readTemplateFromStorage()?.capturedAt).toBe(first)
    })

    it("does not renew an expired key while the stale parameter remains in the URL", () => {
        const win = installWindow("/?template=" + KNOWN_KEY)
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
        const staleUrl = new URL("https://cloud.agenta.ai/?template=" + KNOWN_KEY)
        captureTemplateFromUrl(staleUrl)

        vi.setSystemTime(new Date("2026-01-01T00:31:00Z"))
        expect(captureTemplateFromUrl(staleUrl)).toBeNull()
        expect(readTemplateFromStorage()).toBeNull()
        expect(getDefaultStore().get(activeTemplateAtom)).toBeNull()
        expect(win.location.href).not.toContain("template=")
    })

    it("ignores the key on the in-app create surface, where it only seeds the composer", () => {
        const win = installWindow(`/apps?new=1&template=${KNOWN_KEY}`)
        const url = new URL(`https://cloud.agenta.ai/apps?new=1&template=${KNOWN_KEY}`)
        expect(captureTemplateFromUrl(url)).toBeNull()
        expect(getDefaultStore().get(activeTemplateAtom)).toBeNull()
        expect(readTemplateFromStorage()).toBeNull()
        // The param stays put — the create surface reads it to pre-select the template. Assert the
        // browser URL, not the detached one: only the former proves cleanup left it alone.
        expect(win.location.href).toContain(`template=${KNOWN_KEY}`)
    })

    it("does not restore a stored key on the create surface, and leaves it for a later load", () => {
        installWindow(`/apps?new=1&template=${KNOWN_KEY}`)
        // A record another tab captured from a real website deep-link.
        persistTemplateToStorage({key: KNOWN_KEY, capturedAt: Date.now()})

        const url = new URL(`https://cloud.agenta.ai/apps?new=1&template=${KNOWN_KEY}`)
        expect(captureTemplateFromUrl(url)).toBeNull()
        expect(getDefaultStore().get(activeTemplateAtom)).toBeNull()

        // The record survives: this URL says nothing about the other tab's intent.
        expect(readTemplateFromStorage()?.key).toBe(KNOWN_KEY)
        expect(captureTemplateFromUrl(new URL("https://cloud.agenta.ai/apps"))).toBe(KNOWN_KEY)
    })

    it("disarms an already-active template when the user reaches the create surface", () => {
        installWindow("/")
        const pending = capturePending()
        expect(getDefaultStore().get(activeTemplateAtom)).toEqual(pending)

        captureTemplateFromUrl(new URL("https://cloud.agenta.ai/apps?new=1"))
        expect(getDefaultStore().get(activeTemplateAtom)).toBeNull()
    })

    it("falls back to the stored key when the URL has none (region recapture leaves storage intact)", () => {
        installWindow("/")
        persistTemplateToStorage({key: KNOWN_KEY, capturedAt: Date.now()})
        expect(captureTemplateFromUrl(new URL("https://cloud.agenta.ai/apps"))).toBe(KNOWN_KEY)
        expect(getDefaultStore().get(activeTemplateAtom)?.key).toBe(KNOWN_KEY)
    })
})

describe("clearTemplate", () => {
    it("removes storage, the atom, and the template URL param so it cannot resurrect", () => {
        const win = installWindow(`/apps?template=${KNOWN_KEY}&other=1`)
        persistTemplateToStorage({key: KNOWN_KEY, capturedAt: Date.now()})
        getDefaultStore().set(activeTemplateAtom, {key: KNOWN_KEY, capturedAt: Date.now()})

        clearTemplate()

        expect(readTemplateFromStorage()).toBeNull()
        expect(getDefaultStore().get(activeTemplateAtom)).toBeNull()
        expect(win.location.href).not.toContain("template=")
        expect(win.location.href).toContain("other=1")
        // A capture after clear must not bring the key back from the URL.
        expect(captureTemplateFromUrl(new URL(win.location.href))).toBeNull()
    })
})

describe("claimTemplate (at-most-once)", () => {
    it("best-effort fallback: only the first caller wins when Web Locks is absent", async () => {
        installWindow("/")
        const pending = capturePending()
        expect(await claimTemplate(pending)).toBe(true)
        expect(await claimTemplate(pending)).toBe(false)
    })

    it("Web Locks path: the lock serialises the claim so only one caller wins", async () => {
        const locks = {
            request: (_name: string, cb: () => unknown) => Promise.resolve(cb()),
        }
        installWindow("/", locks)
        const pending = capturePending()
        expect(await claimTemplate(pending)).toBe(true)
        expect(await claimTemplate(pending)).toBe(false)
    })

    it("keeps a completed generation unavailable to a late tab after pending state clears", async () => {
        installWindow("/")
        const pending = capturePending()
        expect(await claimTemplate(pending)).toBe(true)
        await completeTemplateClaim(pending)
        clearTemplate(pending)

        expect(await claimTemplate(pending)).toBe(false)
    })

    it("allows a newly captured generation of the same key", async () => {
        installWindow("/")
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
        const first = capturePending()
        expect(await claimTemplate(first)).toBe(true)
        await completeTemplateClaim(first)
        clearTemplate(first)

        vi.setSystemTime(new Date("2026-01-01T00:00:01Z"))
        const second = capturePending()
        expect(second.capturedAt).not.toBe(first.capturedAt)
        expect(await claimTemplate(second)).toBe(true)
    })

    it("expires an abandoned claim before a later visit with the same key", async () => {
        const win = installWindow("/?template=" + KNOWN_KEY)
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
        const first = capturePending()
        expect(await claimTemplate(first)).toBe(true)

        vi.setSystemTime(new Date("2026-01-01T00:31:00Z"))
        const staleUrl = new URL(win.location.href)
        expect(captureTemplateFromUrl(staleUrl)).toBeNull()

        const second = capturePending()
        expect(await claimTemplate(second)).toBe(true)
    })
})
