/**
 * The judge's connection slug must survive the nest→flatten round-trip.
 *
 * The evaluator config UI edits a NESTED shape (`prompt.llm_config.model`) and commits a FLAT
 * one (`{model, connection, ...}`), which is what `auto_ai_critique_v0` reads. The slug rides
 * beside the model in both, so a judge pointed at a named connection keeps running on that
 * connection's credential — and clearing it persists as a removal, not as "unchanged".
 */
import {describe, expect, it} from "vitest"

import {
    flattenEvaluatorConfiguration,
    nestEvaluatorConfiguration,
} from "../../src/runnable/evaluatorTransforms"
import type {ProviderConnection} from "../../src/secret/core/connections"
import {
    CURRENT_SELECTION_GROUP_KEY,
    buildConnectionModelGroups,
    selectedOptionKey,
    withCurrentSelectionGroup,
} from "../../src/secret/core/promptModelGroups"
import {SecretKind} from "../../src/secret/core/types"

const flatJudge = (extra: Record<string, unknown> = {}) => ({
    prompt_template: [{role: "user", content: "Score {{prediction}}."}],
    model: "gpt-4o-mini",
    response_type: "text",
    ...extra,
})

const llmConfigOf = (nested: Record<string, unknown>) =>
    (nested.prompt as Record<string, unknown>).llm_config as Record<string, unknown>

describe("judge connection — nest", () => {
    it("puts a stored connection slug beside the model in llm_config", () => {
        const nested = nestEvaluatorConfiguration(flatJudge({connection: "openai-2"}))

        expect(llmConfigOf(nested)).toEqual({model: "gpt-4o-mini", connection: "openai-2"})
    })

    it("omits connection for a judge saved before named connections", () => {
        const nested = nestEvaluatorConfiguration(flatJudge())

        expect(llmConfigOf(nested)).toEqual({model: "gpt-4o-mini"})
    })

    it("does not leak connection to the top level via the rest spread", () => {
        const nested = nestEvaluatorConfiguration(flatJudge({connection: "openai-2"}))

        expect("connection" in nested).toBe(false)
    })
})

describe("judge connection — flatten", () => {
    it("writes the slug back to the flat params", () => {
        const flat = flatJudge()
        const nested = nestEvaluatorConfiguration(flat)
        const edited = {
            ...nested,
            prompt: {
                ...(nested.prompt as Record<string, unknown>),
                llm_config: {model: "gpt-4o", connection: "openai-2"},
            },
        }

        expect(flattenEvaluatorConfiguration(edited, flat)).toMatchObject({
            model: "gpt-4o",
            connection: "openai-2",
        })
    })

    it("removes the slug when the model is picked from an option carrying none", () => {
        const flat = flatJudge({connection: "openai-2"})
        const nested = nestEvaluatorConfiguration(flat)
        const edited = {
            ...nested,
            prompt: {
                ...(nested.prompt as Record<string, unknown>),
                llm_config: {model: "gpt-4o"},
            },
        }

        const result = flattenEvaluatorConfiguration(edited, flat)
        expect(result.model).toBe("gpt-4o")
        expect("connection" in result).toBe(false)
    })

    it("removes the slug the way the UI writer actually clears it", () => {
        // `updateConfigKey` (PlaygroundConfigSection/llmConfig.ts) DELETES the key on a null
        // value rather than storing null, so flatten never sees a `connection: null` to react
        // to. Reproduced here because that writer lives a package above this one.
        const writeLLMConfig = (base: Record<string, unknown>, changes: Record<string, unknown>) =>
            Object.entries(changes).reduce<Record<string, unknown>>(
                (acc, [key, value]) => {
                    if (value === null || value === undefined) delete acc[key]
                    else acc[key] = value
                    return acc
                },
                {...base},
            )

        const flat = flatJudge({connection: "openai-2"})
        const nested = nestEvaluatorConfiguration(flat)
        const prompt = nested.prompt as Record<string, unknown>
        const cleared = writeLLMConfig(prompt.llm_config as Record<string, unknown>, {
            model: "gpt-4o",
            connection: null,
        })

        expect("connection" in cleared).toBe(false)

        const result = flattenEvaluatorConfiguration(
            {...nested, prompt: {...prompt, llm_config: cleared}},
            flat,
        )
        expect(result.model).toBe("gpt-4o")
        expect("connection" in result).toBe(false)
    })

    it("leaves a legacy judge's flat params untouched", () => {
        const flat = flatJudge()
        const nested = nestEvaluatorConfiguration(flat)

        const result = flattenEvaluatorConfiguration(nested, flat)
        expect("connection" in result).toBe(false)
        expect(result.model).toBe("gpt-4o-mini")
    })

    it("carries a litellm-spelled model through untouched", () => {
        // The judge edits through the same ModelConfigEditor as the prompt, so what it commits is
        // whatever the picker wrote — a prefixed id must survive the nest→flatten round trip
        // rather than being collapsed back to the provider's own spelling.
        const flat = flatJudge()
        const nested = nestEvaluatorConfiguration(flat)
        const edited = {
            ...nested,
            prompt: {
                ...(nested.prompt as Record<string, unknown>),
                llm_config: {model: "anthropic/claude-haiku-4-5", connection: "anthropic-1"},
            },
        }

        expect(flattenEvaluatorConfiguration(edited, flat)).toMatchObject({
            model: "anthropic/claude-haiku-4-5",
            connection: "anthropic-1",
        })
    })

    it("round-trips an unedited judge with a connection", () => {
        const flat = flatJudge({connection: "openai-2"})

        expect(flattenEvaluatorConfiguration(nestEvaluatorConfiguration(flat), flat)).toMatchObject(
            {model: "gpt-4o-mini", connection: "openai-2"},
        )
    })
})

describe("judge model picker", () => {
    // The judge's model dropdown IS the prompt's — same ModelConfigEditor, fed the same
    // connection-only groups — so what the picker shows for a judge is decided by the nested
    // `llm_config` these transforms produce.
    const openAIConnection: ProviderConnection = {
        id: "conn-1",
        slug: "openai",
        name: "OpenAI",
        kind: "openai",
        title: "OpenAI",
        secretKind: SecretKind.ProviderKey,
        models: ["gpt-4o-mini"],
        source: {},
    }

    const menuFor = (flat: Record<string, unknown>, connections: ProviderConnection[]) => {
        const llmConfig = llmConfigOf(nestEvaluatorConfiguration(flat))
        return withCurrentSelectionGroup({
            groups: buildConnectionModelGroups({connections}),
            model: llmConfig.model as string,
            connectionSlug: (llmConfig.connection as string | undefined) ?? null,
        })
    }

    it("offers the judge only what the project has connected", () => {
        const groups = menuFor(flatJudge({connection: "openai"}), [openAIConnection])

        expect(groups.map((group) => group.label)).toEqual(["OpenAI"])
    })

    it("keeps a judge model no connection offers visible and selected", () => {
        // A judge saved against a key that has since been removed or renamed still runs (family
        // fallback), so its model must not vanish from the control that edits it.
        const groups = menuFor(flatJudge({model: "gpt-4o", connection: "openai-gone"}), [
            openAIConnection,
        ])

        expect(groups.map((group) => group.label)).toEqual(["OpenAI", "Current selection"])
        expect(selectedOptionKey({groups, model: "gpt-4o", connectionSlug: "openai-gone"})).toBe(
            `${CURRENT_SELECTION_GROUP_KEY}:gpt-4o`,
        )
    })

    it("leaves a judge on a project with no connections nothing but its own model", () => {
        expect(menuFor(flatJudge(), []).map((group) => group.label)).toEqual(["Current selection"])
    })
})
