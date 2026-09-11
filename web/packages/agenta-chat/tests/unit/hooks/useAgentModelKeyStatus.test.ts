import {describe, expect, it} from "vitest"

import {
    CONNECT_MODEL_BANNER_MESSAGE,
    CONNECT_MODEL_COMPOSER_PLACEHOLDER,
    connectModelGate,
    modelComposerChrome,
    RUNNER_UNAVAILABLE_BANNER_MESSAGE,
    RUNNER_UNAVAILABLE_COMPOSER_PLACEHOLDER,
} from "../../../src/hooks/useAgentModelKeyStatus"

const facts = (over: Partial<Parameters<typeof connectModelGate>[0]> = {}) => ({
    loading: false,
    candidateCount: 0,
    ...over,
})

describe("connectModelGate", () => {
    it("shows setup after all sources resolve with no runnable candidate", () => {
        expect(connectModelGate(facts())).toBe(true)
    })

    it("stays down when a stored connection or ready subscription contributes a candidate", () => {
        expect(connectModelGate(facts({candidateCount: 1}))).toBe(false)
    })

    it("does not turn loading into an empty-state claim", () => {
        expect(connectModelGate(facts({loading: true}))).toBe(false)
    })

    it("does not blame a missing key when the runner answered unavailable", () => {
        expect(connectModelGate(facts({runnerUnavailable: true}))).toBe(false)
    })
})

describe("modelComposerChrome", () => {
    it("keeps connect-model copy and the providers CTA for a true missing key", () => {
        expect(modelComposerChrome({gateActive: true, runnerUnavailable: false})).toEqual({
            reason: "connect-model",
            locked: true,
            bannerMessage: CONNECT_MODEL_BANNER_MESSAGE,
            showProviderSetup: true,
            placeholder: CONNECT_MODEL_COMPOSER_PLACEHOLDER,
        })
    })

    it("uses runtime-outage copy and no providers CTA when the runner is down", () => {
        const chrome = modelComposerChrome({gateActive: false, runnerUnavailable: true})
        expect(chrome).toEqual({
            reason: "runner-unavailable",
            locked: true,
            bannerMessage: RUNNER_UNAVAILABLE_BANNER_MESSAGE,
            showProviderSetup: false,
            placeholder: RUNNER_UNAVAILABLE_COMPOSER_PLACEHOLDER,
        })
        expect(chrome.bannerMessage).not.toMatch(/provider key|model providers/i)
        expect(chrome.placeholder).not.toMatch(/connect a model/i)
    })

    it("prefers the runtime-outage copy if both flags were ever set", () => {
        expect(modelComposerChrome({gateActive: true, runnerUnavailable: true}).reason).toBe(
            "runner-unavailable",
        )
    })

    it("unlocks the composer when neither lock applies", () => {
        expect(modelComposerChrome({gateActive: false, runnerUnavailable: false})).toEqual({
            reason: null,
            locked: false,
            bannerMessage: null,
            showProviderSetup: false,
            placeholder: undefined,
        })
    })
})
