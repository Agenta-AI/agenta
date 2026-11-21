import {describe, expect, it} from "vitest"

import {listPickerGroups} from "../../src/DrillInView/SchemaControls/agentTemplate/modelPickerLayout"
import type {
    PickerConnectionRow,
    PickerModelRow,
} from "../../src/DrillInView/SchemaControls/connectionPicker"

const model = (modelId: string, extra: Partial<PickerModelRow> = {}): PickerModelRow => ({
    modelId,
    label: modelId,
    harness: "pi_core",
    harnessLabel: "Pi",
    mode: "agenta",
    slug: null,
    namespace: null,
    provider: null,
    connectionKey: "",
    connectionName: "",
    ...extra,
})

const row = (key: string, extra: Partial<PickerConnectionRow> = {}): PickerConnectionRow => ({
    key,
    name: key,
    iconKey: key,
    kind: "connection",
    models: [model(`${key}-model`)],
    ...extra,
})

const builtin = (key: string) =>
    row(key, {
        name: `Built-in: ${key}`,
        models: ["a", "b", "c"].map((id) => model(id, {namespace: "builtin"})),
    })

const LABELS = {label: "Agenta", tag: "Built-in"}

describe("listPickerGroups", () => {
    it("puts the built-in models first as Agenta, then API keys, then subscriptions", () => {
        const groups = listPickerGroups(
            [
                row("chatgpt", {kind: "subscription"}),
                row("openai"),
                builtin("builtin:agenta"),
                row("org-claude", {kind: "subscription", organization: true}),
                row("anthropic-org", {organization: true}),
                row("claude", {kind: "subscription", disabled: true, models: []}),
            ],
            LABELS,
        )
        expect(groups.map((group) => group.key)).toEqual([
            "builtin:agenta",
            "openai",
            "anthropic-org",
            "chatgpt",
            "org-claude",
            "claude",
        ])
        expect(groups[0]).toMatchObject({label: "Agenta", tag: "Built-in"})
        // Every built-in model shows: there is no per-project switch.
        expect(groups[0].options.map((option) => option.value)).toEqual(["a", "b", "c"])
    })

    it("keeps the names of several built-in rows apart", () => {
        const groups = listPickerGroups([builtin("builtin:one"), builtin("builtin:two")], LABELS)
        expect(groups.map((group) => group.label)).toEqual([
            "Built-in: builtin:one",
            "Built-in: builtin:two",
        ])
        expect(groups.every((group) => group.tag === "Built-in")).toBe(true)
    })
})
