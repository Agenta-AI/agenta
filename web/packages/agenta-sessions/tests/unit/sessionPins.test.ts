import {projectIdAtom} from "@agenta/shared/state"
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {pinnedSessionIdsAtom, toggleSessionPinAtom, unpinSessionAtom} from "../../src/state/pins"

const storeFor = (projectId: string) => {
    const store = createStore()
    store.set(projectIdAtom, projectId)
    return store
}

describe("unpinSessionAtom", () => {
    it("drops a pinned session, and leaves the rest of the project's pins alone", () => {
        const store = storeFor("p1")
        store.set(toggleSessionPinAtom, "s1")
        store.set(toggleSessionPinAtom, "s2")

        store.set(unpinSessionAtom, "s1")

        expect(store.get(pinnedSessionIdsAtom)).toEqual(["s2"])
    })

    // Archiving calls this whether or not the row was pinned; a no-op must not rewrite storage.
    it("is a no-op for a session that was never pinned", () => {
        const store = storeFor("p1")
        store.set(toggleSessionPinAtom, "s1")
        const before = store.get(pinnedSessionIdsAtom)

        store.set(unpinSessionAtom, "s9")

        expect(store.get(pinnedSessionIdsAtom)).toBe(before)
    })
})
