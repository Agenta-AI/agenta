// @vitest-environment jsdom
import {activeUserIdAtom} from "@agenta/shared/state"
import {createStore} from "jotai"
import {afterEach, describe, expect, it, vi} from "vitest"

import {
    DEVELOPER_VIEWS_ENV,
    developerViewPreviewAtomFamily,
    developerViewPreviewSwitchesAtom,
    enabledDeveloperViewsAtom,
    isDeveloperViewEnabled,
    readForcedDeveloperViewIds,
} from "@/features/developer/developerViewAccess"

import {TEST_DEVELOPER_VIEWS} from "./developerViewFixtures"

vi.mock("@/features/developer/developerViews", async () => ({
    DEVELOPER_VIEWS: (await import("./developerViewFixtures")).TEST_DEVELOPER_VIEWS,
}))

const [hidden, preview, on, gate] = TEST_DEVELOPER_VIEWS
const NONE = new Set<string>()

const signedInStore = () => {
    const store = createStore()
    store.set(activeUserIdAtom, "u1")
    return store
}
const enabledIds = (store: ReturnType<typeof createStore>) =>
    store.get(enabledDeveloperViewsAtom)?.map((view) => view.id)

afterEach(() => {
    delete process.env[DEVELOPER_VIEWS_ENV]
    localStorage.clear()
})

describe("isDeveloperViewEnabled", () => {
    it("shows an on view, hides a hidden view, and shows a preview view only when opted in", () => {
        expect(isDeveloperViewEnabled(on, {previewOptedIn: false, forcedIds: NONE})).toBe(true)
        expect(isDeveloperViewEnabled(hidden, {previewOptedIn: true, forcedIds: NONE})).toBe(false)
        expect(isDeveloperViewEnabled(preview, {previewOptedIn: false, forcedIds: NONE})).toBe(
            false,
        )
        expect(isDeveloperViewEnabled(preview, {previewOptedIn: true, forcedIds: NONE})).toBe(true)
    })

    it("shows any view the deployment forces on, whatever its stage", () => {
        const forcedIds = new Set(["lab-hidden"])
        expect(isDeveloperViewEnabled(hidden, {previewOptedIn: false, forcedIds})).toBe(true)
    })
})

describe("readForcedDeveloperViewIds", () => {
    it("reads a comma-separated list, trimmed and lowercased", () => {
        expect(readForcedDeveloperViewIds().size).toBe(0)
        process.env[DEVELOPER_VIEWS_ENV] = " Lab-Hidden, ,lab-on "
        expect([...readForcedDeveloperViewIds()]).toEqual(["lab-hidden", "lab-on"])
    })
})

describe("enabledDeveloperViewsAtom", () => {
    it("has no answer until the signed-in user is known", () => {
        expect(createStore().get(enabledDeveloperViewsAtom)).toBeNull()
    })

    it("lists only the on view by default", () => {
        expect(enabledIds(signedInStore())).toEqual(["lab-on"])
    })

    it("adds a preview view once the user switches it on, and stores that per user", () => {
        const store = signedInStore()
        store.set(developerViewPreviewSwitchesAtom, {viewId: "lab-preview", enabled: true})
        expect(enabledIds(store)).toEqual(["lab-preview", "lab-on"])
        expect(localStorage.getItem("agenta:settings:u1:developer-view:lab-preview")).toBe("true")

        store.set(activeUserIdAtom, "u2")
        expect(enabledIds(store)).toEqual(["lab-on"])
    })

    it("adds a hidden view the env forces on", () => {
        process.env[DEVELOPER_VIEWS_ENV] = "lab-hidden"
        expect(enabledIds(signedInStore())).toEqual(["lab-hidden", "lab-on"])
    })
})

describe("developerViewPreviewSwitchesAtom", () => {
    it("offers a switch for each preview view, pages and feature gates alike", () => {
        const store = signedInStore()
        expect(store.get(developerViewPreviewSwitchesAtom)).toEqual([
            {view: preview, enabled: false},
            {view: gate, enabled: false},
        ])
        store.set(developerViewPreviewAtomFamily("lab-gate"), true)
        expect(store.get(developerViewPreviewSwitchesAtom)).toEqual([
            {view: preview, enabled: false},
            {view: gate, enabled: true},
        ])
        expect(enabledIds(store)).toEqual(["lab-on", "lab-gate"])
    })

    it("offers no switch for a preview view the env already forces on", () => {
        process.env[DEVELOPER_VIEWS_ENV] = "lab-preview"
        expect(signedInStore().get(developerViewPreviewSwitchesAtom)).toEqual([
            {view: gate, enabled: false},
        ])
    })
})
