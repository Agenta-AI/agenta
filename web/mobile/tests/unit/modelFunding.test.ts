import {describe, expect, it} from "vitest"

import {isCreditFunded, modelFunding} from "../../src/features/wallet/modelFunding"

const BUILTIN = {slug: "agenta", namespace: "builtin"}
const OWN_KEY = {slug: "openai-prod", namespace: "standard"}
const SUBSCRIPTION = {slug: "claude", namespace: null}

describe("modelFunding", () => {
    it("reads a builtin connection with another route as switchable", () => {
        expect(
            modelFunding({mode: "agenta", slug: "agenta", namespace: "builtin"}, [
                BUILTIN,
                OWN_KEY,
            ]),
        ).toBe("credits-with-own-key")
    })

    it("reads a builtin connection with no other route as needing a key", () => {
        expect(
            modelFunding({mode: "agenta", slug: "agenta", namespace: "builtin"}, [BUILTIN]),
        ).toBe("credits-no-own-key")
    })

    it("counts a subscription as an own route", () => {
        expect(
            modelFunding({mode: "agenta", slug: "agenta", namespace: "builtin"}, [
                BUILTIN,
                SUBSCRIPTION,
            ]),
        ).toBe("credits-with-own-key")
    })

    it("reads a stored provider key as own-key", () => {
        expect(
            modelFunding({mode: "agenta", slug: "openai-prod", namespace: "standard"}, [
                BUILTIN,
                OWN_KEY,
            ]),
        ).toBe("own-key")
    })

    it("reads an older save with a builtin slug and no namespace as credits", () => {
        expect(modelFunding({mode: "agenta", slug: "agenta"}, [BUILTIN, OWN_KEY])).toBe(
            "credits-with-own-key",
        )
    })

    it("reads an older save with a custom slug and no namespace as own-key", () => {
        expect(modelFunding({mode: "agenta", slug: "openai-prod"}, [BUILTIN, OWN_KEY])).toBe(
            "own-key",
        )
    })

    it("reads a self-managed subscription login as own-key", () => {
        expect(modelFunding({mode: "self_managed"}, [BUILTIN, SUBSCRIPTION])).toBe("own-key")
    })

    it("reads no connection at all as credits", () => {
        expect(modelFunding(null, [BUILTIN])).toBe("credits-no-own-key")
    })

    it("treats only the built-in routes as spending credits", () => {
        expect(isCreditFunded("credits-with-own-key")).toBe(true)
        expect(isCreditFunded("credits-no-own-key")).toBe(true)
        expect(isCreditFunded("own-key")).toBe(false)
        expect(isCreditFunded(null)).toBe(false)
    })
})
