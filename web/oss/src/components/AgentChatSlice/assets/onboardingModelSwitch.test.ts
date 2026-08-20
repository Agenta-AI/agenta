/**
 * The onboarding auto-switch decision. The live bug it closes: the founder connected OpenRouter
 * through the connect-model gate and the chat stayed on the seeded default model, whose provider
 * had no key — so the agent was still unrunnable right after "setting it up".
 */
import type {PickerConnectionRow} from "@agenta/entity-ui/drill-in"
import {describe, expect, it} from "vitest"

import {onboardingModelSwitch} from "./onboardingModelSwitch"

const model = (overrides: Partial<PickerConnectionRow["models"][number]> = {}) => ({
    modelId: "openrouter/deepseek-v4",
    label: "DeepSeek V4",
    harness: "pi_core",
    harnessLabel: "Pi",
    mode: "agenta" as const,
    slug: "openrouter",
    provider: "openrouter",
    connectionKey: "new",
    connectionName: "OpenRouter",
    ...overrides,
})

const row = (overrides: Partial<PickerConnectionRow> = {}): PickerConnectionRow => ({
    key: "new",
    name: "OpenRouter",
    iconKey: "openrouter",
    kind: "connection",
    models: [model()],
    ...overrides,
})

/** The connection the project already had when the drawer was opened. */
const existing = row({
    key: "old",
    name: "OpenAI",
    iconKey: "openai",
    models: [model({connectionKey: "old"})],
})

describe("onboardingModelSwitch", () => {
    it("switches to the new connection's first model, composed by the row rules", () => {
        expect(
            onboardingModelSwitch({
                onboarding: true,
                previousConnectionKeys: ["old"],
                rows: [existing, row()],
            }),
        ).toEqual({
            modelId: "openrouter/deepseek-v4",
            provider: "openrouter",
            mode: "agenta",
            slug: "openrouter",
            harness: "pi_core",
        })
    })

    it("leaves the current model alone for a normal mid-session save", () => {
        // Same save, but the drawer came from the picker's "Add provider" footer: the user was
        // adding a credential, not choosing a model.
        expect(
            onboardingModelSwitch({
                onboarding: false,
                previousConnectionKeys: ["old"],
                rows: [existing, row()],
            }),
        ).toBeNull()
    })

    it("switches nothing when the new connection offers no models", () => {
        // An endpoint with no discovery and no model added by hand. The caller opens the picker
        // rather than guessing a model this connection may not serve.
        expect(
            onboardingModelSwitch({
                onboarding: true,
                previousConnectionKeys: ["old"],
                rows: [existing, row({models: []})],
            }),
        ).toBeNull()
    })

    it("switches nothing when no connection was actually added", () => {
        // Done pressed on an unchanged card, or a save that failed to produce a row.
        expect(
            onboardingModelSwitch({
                onboarding: true,
                previousConnectionKeys: ["old"],
                rows: [existing],
            }),
        ).toBeNull()
    })

    it("never adopts a subscription row as the newly created connection", () => {
        // A mounted login is ambient — it is not what the drawer just created, even though it is
        // absent from the keys seen before (the harness catalog can publish it at any time).
        const subscription = row({
            key: "subscription:claude",
            name: "Claude",
            kind: "subscription",
            models: [model({connectionKey: "subscription:claude", harness: "claude", slug: null})],
        })
        expect(
            onboardingModelSwitch({
                onboarding: true,
                previousConnectionKeys: ["old"],
                rows: [existing, subscription],
            }),
        ).toBeNull()
    })
})
