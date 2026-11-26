// @vitest-environment jsdom
import {activeUserIdAtom} from "@agenta/shared/state"
import {createStore} from "jotai"
import {afterEach, describe, expect, it, vi} from "vitest"

import {
    DEVELOPER_VIEWS_ENV,
    enabledDeveloperViewsAtom,
    readForcedDeveloperViewIds,
} from "@/features/developer/developerViewAccess"

vi.mock("@/features/developer/developerViews", async () => ({
    DEVELOPER_VIEWS: (await import("./developerViewFixtures")).TEST_DEVELOPER_VIEWS,
}))

const signedInStore = () => {
    const store = createStore()
    store.set(activeUserIdAtom, "u1")
    return store
}
const enabledIds = (store: ReturnType<typeof createStore>) =>
    store.get(enabledDeveloperViewsAtom)?.map((view) => view.id)

afterEach(() => {
    delete process.env[DEVELOPER_VIEWS_ENV]
})

describe("readForcedDeveloperViewIds", () => {
    it("reads a comma-separated list, trimmed and lowercased", () => {
        expect(readForcedDeveloperViewIds().size).toBe(0)
        process.env[DEVELOPER_VIEWS_ENV] = " Lab-One, ,lab-gate "
        expect([...readForcedDeveloperViewIds()]).toEqual(["lab-one", "lab-gate"])
    })
})

describe("enabledDeveloperViewsAtom", () => {
    it("has no answer until the signed-in user is known", () => {
        expect(createStore().get(enabledDeveloperViewsAtom)).toBeNull()
    })

    it("lists no view without beta developer mode", () => {
        expect(enabledIds(signedInStore())).toEqual([])
    })

    it("lists the views the env forces on, pages and feature gates alike", () => {
        process.env[DEVELOPER_VIEWS_ENV] = "lab-two,lab-gate"
        expect(enabledIds(signedInStore())).toEqual(["lab-two", "lab-gate"])
    })
})
