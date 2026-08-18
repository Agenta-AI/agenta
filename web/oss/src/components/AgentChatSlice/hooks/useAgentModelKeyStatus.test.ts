import {describe, expect, it} from "vitest"

import {connectModelGate} from "./useAgentModelKeyStatus"

const facts = (over: Partial<Parameters<typeof connectModelGate>[0]> = {}) => ({
    loading: false,
    connectionCount: 0,
    selfManaged: false,
    keySetupDone: false,
    hasProviderEntry: true,
    ...over,
})

describe("connectModelGate", () => {
    it("asks for a key when the project has no provider connection", () => {
        expect(connectModelGate(facts())).toBe(true)
    })

    it("still asks when the only vault row is a named secret", () => {
        // The regression: a project holding an MCP token and nothing else credentials no model.
        // Counting that row as "the vault isn't empty" let the composer through to a run that
        // failed mid-turn with "no usable credential". Named secrets never become connections
        // (see `toProviderConnections`), so the count here is zero and the gate holds.
        expect(connectModelGate(facts({connectionCount: 0}))).toBe(true)
    })

    it("stands down once any provider connection exists", () => {
        expect(connectModelGate(facts({connectionCount: 1}))).toBe(false)
    })

    it("never fires while the vault is still loading", () => {
        expect(connectModelGate(facts({loading: true}))).toBe(false)
    })

    it("never fires for a self-managed agent, which signs itself in", () => {
        expect(connectModelGate(facts({selfManaged: true}))).toBe(false)
    })

    it("never fires again once the user has connected a key before", () => {
        expect(connectModelGate(facts({keySetupDone: true}))).toBe(false)
    })

    it("stays quiet for a provider with no standard vault slot", () => {
        expect(connectModelGate(facts({hasProviderEntry: false}))).toBe(false)
    })
})
