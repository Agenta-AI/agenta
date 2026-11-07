import {getDefaultStore} from "jotai"
import {afterEach, describe, expect, it, vi} from "vitest"

import {createT, defineCatalog, loadWithText} from "../../src/catalog"
import {activeLanguageAtom, languageAtom} from "../../src/language"
import {CATALOG_TIMEOUT_MS, catalogVersionAtom, loadLanguage} from "../../src/registry"

const store = getDefaultStore()

afterEach(() => {
    vi.useRealTimers()
    store.set(activeLanguageAtom, "en")
})

describe("a catalog that cannot load", () => {
    it("falls back to English and re-renders when the loader rejects", async () => {
        const broken = defineCatalog(
            "settings.broken",
            {title: "Broken"},
            {
                "zh-CN": () => Promise.reject(new Error("offline")),
                "ja-JP": () => Promise.reject(new Error("offline")),
            },
        )
        const t = createT(broken)
        store.set(activeLanguageAtom, "zh-CN")
        const before = store.get(catalogVersionAtom)
        await loadLanguage("zh-CN")
        expect(store.get(catalogVersionAtom)).toBeGreaterThan(before)
        expect(t("settings.broken.title")).toBe("Broken")
    })

    it("gives up on a hanging load at the timeout, showing English throughout", async () => {
        vi.useFakeTimers()
        const stuck = defineCatalog(
            "settings.stuck",
            {title: "Stuck"},
            {
                "zh-CN": () => new Promise(() => undefined),
                "ja-JP": () => new Promise(() => undefined),
            },
        )
        const t = createT(stuck)
        store.set(activeLanguageAtom, "zh-CN")
        let settled = false
        const loading = loadLanguage("zh-CN").then(() => {
            settled = true
        })
        expect(t("settings.stuck.title")).toBe("Stuck")
        await vi.advanceTimersByTimeAsync(CATALOG_TIMEOUT_MS - 1)
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        await loading
        expect(settled).toBe(true)
        expect(t("settings.stuck.title")).toBe("Stuck")
    })
})

describe("loadWithText", () => {
    it("resolves with the module even when its catalog fails", async () => {
        const module = await loadWithText(async () => {
            defineCatalog(
                "settings.panelBroken",
                {title: "Panel"},
                {
                    "zh-CN": () => Promise.reject(new Error("offline")),
                    "ja-JP": () => Promise.reject(new Error("offline")),
                },
            )
            return {Panel: "panel"}
        })
        expect(module.Panel).toBe("panel")
    })

    it("waits for the module's own catalogs in the chosen language", async () => {
        vi.stubGlobal("document", {cookie: ""})
        store.set(languageAtom, "zh-CN")
        let t: ((key: "settings.panelOk.title") => string) | undefined
        await loadWithText(async () => {
            const panel = defineCatalog(
                "settings.panelOk",
                {title: "Panel"},
                {
                    "zh-CN": async () => ({default: {title: "面板"}}),
                    "ja-JP": async () => ({default: {title: "パネル"}}),
                },
            )
            t = createT(panel)
        })
        store.set(activeLanguageAtom, "zh-CN")
        expect(t?.("settings.panelOk.title")).toBe("面板")
        store.set(languageAtom, "en")
        vi.unstubAllGlobals()
    })
})
