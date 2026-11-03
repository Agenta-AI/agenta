/**
 * The provider ↔ litellm model id translation.
 *
 * A connection stores the provider's own spelling; the prompt runtime is litellm. These functions
 * are the only place the two meet, and the table is kept key-for-key identical to the SDK's — a
 * disagreement makes a persisted model id resolve to nothing at run time.
 */
import {describe, expect, it} from "vitest"

import {
    LITELLM_MODEL_PREFIXES,
    fromLitellmModelId,
    toLitellmModelId,
} from "../../src/secret/core/litellmModelId"
import {STANDARD_PROVIDER_KINDS, StandardProviderKind} from "../../src/secret/core/types"

/** family, provider's own spelling, litellm's spelling. */
const TRANSLATIONS: [string, string, string][] = [
    // Bare IS litellm's OpenAI spelling — the one family that takes no prefix.
    ["openai", "gpt-4o-mini", "gpt-4o-mini"],
    ["anthropic", "claude-sonnet-5", "anthropic/claude-sonnet-5"],
    ["cohere", "command-r-plus", "cohere/command-r-plus"],
    ["deepinfra", "Qwen/Qwen3-32B", "deepinfra/Qwen/Qwen3-32B"],
    // The vault kind and litellm's family name disagree here.
    ["perplexityai", "sonar-pro", "perplexity/sonar-pro"],
    ["groq", "llama-3.3-70b-versatile", "groq/llama-3.3-70b-versatile"],
    ["minimax", "MiniMax-M3", "minimax/MiniMax-M3"],
    ["mistral", "mistral-large-latest", "mistral/mistral-large-latest"],
    // Legacy alias kind, same litellm family as `mistral`.
    ["mistralai", "mistral-large-latest", "mistral/mistral-large-latest"],
    [
        "together_ai",
        "Qwen/Qwen2.5-72B-Instruct-Turbo",
        "together_ai/Qwen/Qwen2.5-72B-Instruct-Turbo",
    ],
    ["openrouter", "anthropic/claude-opus-4.8", "openrouter/anthropic/claude-opus-4.8"],
    ["gemini", "gemini-2.5-pro", "gemini/gemini-2.5-pro"],
]

const CUSTOM_KINDS = ["azure", "bedrock", "sagemaker", "vertex_ai", "custom"]

/**
 * Stored kinds with no prompt-catalog models and no litellm provider, so they translate to
 * themselves. The SDK pins the same pair in `test_the_modelless_kinds_are_identity`, so a third
 * entry here has to land there in the same change or that test fails.
 */
const MODELLESS_KINDS = ["anyscale", "alephalpha"]

describe("LITELLM_MODEL_PREFIXES", () => {
    it("covers every standard provider kind the wire enum declares", () => {
        for (const kind of STANDARD_PROVIDER_KINDS) {
            expect(Object.keys(LITELLM_MODEL_PREFIXES)).toContain(kind)
        }
        // The alias is not in STANDARD_PROVIDER_KINDS but is a stored kind, so it needs an entry.
        expect(LITELLM_MODEL_PREFIXES[StandardProviderKind.Mistralai]).toBe("mistral")
    })

    it("spells OpenAI bare and Perplexity as litellm does, not as the vault kind does", () => {
        expect(LITELLM_MODEL_PREFIXES.openai).toBeNull()
        expect(LITELLM_MODEL_PREFIXES.perplexityai).toBe("perplexity")
    })

    it.each(MODELLESS_KINDS)("claims no prefix for %s, which litellm cannot route", (kind) => {
        // litellm 1.92.0 knows neither provider, so "aleph_alpha/luminous-base" fails exactly as
        // the bare id does. The key is present — both halves cover the same kinds — but a prefix
        // that cannot route would be a false claim, so the value is null.
        expect(LITELLM_MODEL_PREFIXES[kind as keyof typeof LITELLM_MODEL_PREFIXES]).toBeNull()
    })
})

describe("toLitellmModelId", () => {
    it.each(TRANSLATIONS)("prefixes a %s model", (family, native, litellm) => {
        expect(toLitellmModelId(native, family)).toBe(litellm)
    })

    it.each(TRANSLATIONS)("is idempotent for a %s model", (family, _native, litellm) => {
        expect(toLitellmModelId(litellm, family)).toBe(litellm)
    })

    it("adds only the family's own prefix, never a second one to a vendor segment", () => {
        // OpenRouter ids are `vendor/model` before litellm sees them, so the naive "already has a
        // slash" check would leave them unprefixed and the naive "always prefix" would double it.
        expect(toLitellmModelId("anthropic/claude-opus-4.8", "openrouter")).toBe(
            "openrouter/anthropic/claude-opus-4.8",
        )
        expect(toLitellmModelId("openrouter/anthropic/claude-opus-4.8", "openrouter")).toBe(
            "openrouter/anthropic/claude-opus-4.8",
        )
    })

    it("translates an id no catalog ever listed, which is the point of doing it here", () => {
        expect(toLitellmModelId("claude-unreleased-9", "anthropic")).toBe(
            "anthropic/claude-unreleased-9",
        )
    })

    it.each(CUSTOM_KINDS)("leaves a %s model key exactly as stored", (kind) => {
        expect(toLitellmModelId("my-gw/custom/gpt-4o-mini", kind)).toBe("my-gw/custom/gpt-4o-mini")
        expect(toLitellmModelId("gpt-4o-mini", kind)).toBe("gpt-4o-mini")
    })

    it("leaves a family it does not know alone rather than guessing a prefix", () => {
        expect(toLitellmModelId("some-model", "brand-new-provider")).toBe("some-model")
        expect(toLitellmModelId("some-model", null)).toBe("some-model")
        expect(toLitellmModelId("", "anthropic")).toBe("")
    })

    it.each(MODELLESS_KINDS)("leaves a %s model alone in both directions", (kind) => {
        expect(toLitellmModelId("luminous-base", kind)).toBe("luminous-base")
        expect(fromLitellmModelId("luminous-base", kind)).toBe("luminous-base")
    })
})

describe("fromLitellmModelId", () => {
    it.each(TRANSLATIONS)("strips the %s prefix", (family, native, litellm) => {
        expect(fromLitellmModelId(litellm, family)).toBe(native)
    })

    it.each(TRANSLATIONS)("leaves an already-native %s id alone", (family, native) => {
        expect(fromLitellmModelId(native, family)).toBe(native)
    })

    it("strips only the family prefix, keeping an OpenRouter vendor segment", () => {
        expect(fromLitellmModelId("openrouter/anthropic/claude-opus-4.8", "openrouter")).toBe(
            "anthropic/claude-opus-4.8",
        )
    })

    it.each(CUSTOM_KINDS)("leaves a %s model key exactly as stored", (kind) => {
        expect(fromLitellmModelId("my-gw/custom/gpt-4o-mini", kind)).toBe(
            "my-gw/custom/gpt-4o-mini",
        )
    })

    it("round-trips every family", () => {
        for (const [family, native] of TRANSLATIONS) {
            expect(fromLitellmModelId(toLitellmModelId(native, family), family)).toBe(native)
        }
    })
})
