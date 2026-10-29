import {projectIdAtom} from "@agenta/shared/state"
import {createStore} from "jotai"
import {describe, expect, it, vi} from "vitest"

const setSessionHeader = vi.hoisted(() => vi.fn())

vi.mock("@agenta/entities/session", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/session")>()),
    setSessionHeader,
}))

import {adoptSessionAtomFamily, renameSessionAtomFamily, sessionHistoryAtomFamily} from "./sessions"

const titleOf = (store: ReturnType<typeof createStore>, scope: string, id: string) =>
    store.get(sessionHistoryAtomFamily(scope)).find((s) => s.id === id)?.title

describe("renameSessionAtomFamily", () => {
    it("resolves true and keeps the new title when the header takes it", async () => {
        setSessionHeader.mockResolvedValueOnce(true)
        const scope = `rename-ok-${Date.now()}`
        const store = createStore()
        store.set(projectIdAtom, "proj-test")
        store.set(adoptSessionAtomFamily(scope), {id: "one", title: "First"})

        await expect(
            store.set(renameSessionAtomFamily(scope), {id: "one", title: "Renamed"}),
        ).resolves.toBe(true)
        expect(titleOf(store, scope, "one")).toBe("Renamed")
        expect(setSessionHeader).toHaveBeenCalledWith(
            expect.objectContaining({sessionId: "one", name: "Renamed", nameSource: "manual"}),
        )
    })

    it("resolves false and restores the old title when the header refuses it", async () => {
        // The tab showed the new name while the server kept the old one; the next list read
        // then put the old name back with no word to the person who typed it (#6695).
        setSessionHeader.mockResolvedValueOnce(false)
        const scope = `rename-refused-${Date.now()}`
        const store = createStore()
        store.set(projectIdAtom, "proj-test")
        store.set(adoptSessionAtomFamily(scope), {id: "one", title: "First"})

        const write = store.set(renameSessionAtomFamily(scope), {id: "one", title: "Renamed"})
        // Optimistic while the write is in flight.
        expect(titleOf(store, scope, "one")).toBe("Renamed")
        await expect(write).resolves.toBe(false)
        expect(titleOf(store, scope, "one")).toBe("First")
    })

    it("resolves false when the header write throws", async () => {
        setSessionHeader.mockRejectedValueOnce(new Error("network"))
        const scope = `rename-threw-${Date.now()}`
        const store = createStore()
        store.set(projectIdAtom, "proj-test")
        store.set(adoptSessionAtomFamily(scope), {id: "one", title: "First"})

        await expect(
            store.set(renameSessionAtomFamily(scope), {id: "one", title: "Renamed"}),
        ).resolves.toBe(false)
        expect(titleOf(store, scope, "one")).toBe("First")
    })
})
