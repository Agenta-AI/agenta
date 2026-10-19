import {describe, expect, it} from "vitest"

import type {ProviderGroup, ProviderOption} from "../../src/SelectLLMProvider/types"
import {optionMatchesSearch} from "../../src/SelectLLMProvider/utils"

const option: ProviderOption = {
    label: "gpt-5.6-sol",
    value: "openai/gpt-5.6-sol",
    searchCaption: "ChatGPT (deployment login)",
}
const group: ProviderGroup = {label: "ChatGPT", caption: "Deployment login", options: [option]}

describe("optionMatchesSearch", () => {
    it("matches the model by its label, value, and group name", () => {
        expect(optionMatchesSearch(option, group, "sol")).toBe(true)
        expect(optionMatchesSearch(option, group, "openai/")).toBe(true)
        expect(optionMatchesSearch(option, group, "chatgpt")).toBe(true)
    })

    it("keeps a mounted subscription findable by where its login comes from", () => {
        expect(optionMatchesSearch(option, group, "deployment login")).toBe(true)
        expect(optionMatchesSearch(option, {...group, caption: undefined}, "deployment")).toBe(true)
    })

    it("matches an option's own caption", () => {
        const current: ProviderOption = {label: "gpt-4o", value: "gpt-4o", caption: "Not connected"}
        expect(optionMatchesSearch(current, {options: [current]}, "not connected")).toBe(true)
    })

    it("rejects text the option does not show", () => {
        expect(optionMatchesSearch(option, group, "claude")).toBe(false)
    })
})
