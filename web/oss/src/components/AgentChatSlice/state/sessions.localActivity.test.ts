/**
 * Local usage stamps behind the sidebar's "agents by last used" ordering.
 *
 * The trap these pin: opening an agent's playground seeds a blank tab, so counting every stored
 * session would rank an agent you merely visited above one you actually ran.
 */
import {createStore} from "jotai"
import {describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/session", () => ({
    deleteSessionRemote: vi.fn(async () => true),
    archiveSessionRemote: vi.fn(async () => true),
    unarchiveSessionRemote: vi.fn(async () => true),
    setSessionHeader: vi.fn(async () => true),
}))

const {addSessionAtomFamily, bumpSessionActivityAtomFamily, localAgentActivityAtom} =
    await import("./sessions")

const AGENT = "33333333-3333-4333-8333-333333333333"

// A fresh store per test is the isolation here — the persisted atoms start from their defaults.
describe("localAgentActivityAtom", () => {
    it("ignores a seeded blank tab", () => {
        const store = createStore()
        store.set(addSessionAtomFamily(AGENT))

        expect(store.get(localAgentActivityAtom)[AGENT]).toBeUndefined()
    })

    it("stamps the agent once a turn settles", () => {
        const store = createStore()
        const id = store.set(addSessionAtomFamily(AGENT)) as string
        store.set(bumpSessionActivityAtomFamily(AGENT), id)

        expect(store.get(localAgentActivityAtom)[AGENT]).toBeGreaterThan(0)
    })

    // `__global__`, `drawer:<id>` and `onboarding` scopes name no agent.
    it("skips scopes that are not an app id", () => {
        const store = createStore()
        const id = store.set(addSessionAtomFamily("__global__")) as string
        store.set(bumpSessionActivityAtomFamily("__global__"), id)

        expect(store.get(localAgentActivityAtom)).toEqual({})
    })
})
