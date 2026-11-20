import type {ProviderGroup} from "@agenta/ui/select-llm-provider"
import {describe, expect, it} from "vitest"

import {groupsForList} from "../../src/DrillInView/SchemaControls/agentTemplate/modelPickerLayout"

const group = (key: string, extra: Partial<ProviderGroup> = {}): ProviderGroup => ({
    key,
    label: key,
    options: [],
    ...extra,
})

describe("groupsForList", () => {
    it("puts the built-in models first as Agenta, then API keys, then subscriptions", () => {
        const groups = groupsForList(
            [
                group("openai"),
                group("chatgpt", {tag: "Subscription", tagTone: "olive"}),
                group("builtin:agenta", {label: "Built-in: agenta"}),
                group("anthropic-org", {tag: "Organization"}),
                group("claude", {disabled: true, caption: "Sign in needed"}),
            ],
            {label: "Agenta", tag: "Built-in"},
        )
        expect(groups.map((g) => g.key)).toEqual([
            "builtin:agenta",
            "openai",
            "anthropic-org",
            "chatgpt",
            "claude",
        ])
        expect(groups[0]).toMatchObject({label: "Agenta", tag: "Built-in", iconKey: "agenta"})
    })

    it("hides no built-in model: every option of the built-in group stays", () => {
        const options = ["a", "b", "c"].map((value) => ({value, label: value}))
        const [builtin] = groupsForList([group("builtin:agenta", {options})], {
            label: "Agenta",
            tag: "Built-in",
        })
        expect(builtin.options).toHaveLength(3)
    })
})
