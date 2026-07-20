import {getDefaultStore} from "jotai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {AGENT_TEMPLATES} from "../../components/pages/agent-home/assets/templates"

import {
    activeTemplateAtom,
    captureTemplateFromUrl,
    claimTemplate,
    clearTemplate,
    isValidTemplateKey,
    parseTemplateFromUrl,
    persistTemplateToStorage,
    readTemplateFromStorage,
    resolveTemplate,
    TEMPLATE_TTL_MS,
} from "./template"

const KNOWN_KEY = AGENT_TEMPLATES[0].key

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

describe("registry validation", () => {
    it("resolves a known key to its template and validates it", () => {
        expect(resolveTemplate(KNOWN_KEY)?.key).toBe(KNOWN_KEY)
        expect(isValidTemplateKey(KNOWN_KEY)).toBe(true)
    })

    it("rejects an unknown or stale key without falling back to another template", () => {
        expect(resolveTemplate("not-a-real-template")).toBeUndefined()
        expect(isValidTemplateKey("not-a-real-template")).toBe(false)
        expect(resolveTemplate(null)).toBeUndefined()
        expect(isValidTemplateKey("")).toBe(false)
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
        expect(getDefaultStore().get(activeTemplateAtom)).toBe(KNOWN_KEY)
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

    it("falls back to the stored key when the URL has none (region recapture leaves storage intact)", () => {
        installWindow("/")
        persistTemplateToStorage({key: KNOWN_KEY, capturedAt: Date.now()})
        expect(captureTemplateFromUrl(new URL("https://cloud.agenta.ai/apps"))).toBe(KNOWN_KEY)
        expect(getDefaultStore().get(activeTemplateAtom)).toBe(KNOWN_KEY)
    })
})

describe("clearTemplate", () => {
    it("removes storage, the atom, and the template URL param so it cannot resurrect", () => {
        const win = installWindow(`/apps?template=${KNOWN_KEY}&other=1`)
        persistTemplateToStorage({key: KNOWN_KEY, capturedAt: Date.now()})
        getDefaultStore().set(activeTemplateAtom, KNOWN_KEY)

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
        expect(await claimTemplate(KNOWN_KEY)).toBe(true)
        expect(await claimTemplate(KNOWN_KEY)).toBe(false)
    })

    it("Web Locks path: the lock serialises the claim so only one caller wins", async () => {
        const locks = {
            request: (_name: string, cb: () => boolean) => Promise.resolve(cb()),
        }
        installWindow("/", locks)
        expect(await claimTemplate(KNOWN_KEY)).toBe(true)
        expect(await claimTemplate(KNOWN_KEY)).toBe(false)
    })

    it("a fresh key can be claimed again after the previous template is cleared", async () => {
        installWindow("/")
        expect(await claimTemplate(KNOWN_KEY)).toBe(true)
        clearTemplate()
        expect(await claimTemplate(KNOWN_KEY)).toBe(true)
    })
})
