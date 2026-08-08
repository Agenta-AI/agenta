/**
 * Unit tests for the chat composer's `/model`, `/harness`, and `/permissions` config write-through.
 *
 * These patch the agent template from outside the drawer. Both shapes
 * matter: the playground nests the template under `parameters.agent`, a bare template IS the
 * parameters — a write to the wrong one runs against a stale model. Runs under @agenta/entity-ui's
 * own vitest runner.
 */
import {describe, expect, it} from "vitest"

import {
    readHarnessKind,
    readModelId,
    readRunnerPermission,
    withHarnessKind,
    withModel,
    withRunnerPermission,
} from "../../src/DrillInView/SchemaControls/agentConfigPatch"

const template = (extra: Record<string, unknown> = {}) => ({
    instructions: {agents_md: "hi"},
    llm: {model: "gpt-4o", provider: "openai"},
    harness: {kind: "pi_core", permissions: {allow: ["Read"]}},
    ...extra,
})

const nested = (extra?: Record<string, unknown>) => ({agent: template(extra)})

describe("withModel", () => {
    it("writes the ModelRef under parameters.agent", () => {
        const next = withModel(nested(), {modelId: "claude-sonnet-4-5", provider: "anthropic"})
        expect((next as any).agent.llm).toEqual({
            model: "claude-sonnet-4-5",
            provider: "anthropic",
        })
    })

    it("writes a bare template in place", () => {
        const next = withModel(template(), {modelId: "gpt-5", provider: "openai"})
        expect((next as any).llm).toEqual({model: "gpt-5", provider: "openai"})
        expect((next as any).agent).toBeUndefined()
    })

    it("keeps the stored connection when the patch does not name one", () => {
        const params = nested({
            llm: {
                model: "gpt-4o",
                provider: "openai",
                connection: {mode: "agenta", slug: "prod-key"},
            },
        })
        const next = withModel(params, {modelId: "gpt-5", provider: "openai"})
        expect((next as any).agent.llm.connection).toEqual({mode: "agenta", slug: "prod-key"})
    })

    it("carries extra keys on the prior ref through", () => {
        const params = nested({llm: {model: "gpt-4o", provider: "openai", extras: {seed: 7}}})
        const next = withModel(params, {modelId: "gpt-5", provider: "openai"})
        expect((next as any).agent.llm.extras).toEqual({seed: 7})
    })

    it("overrides the connection when the patch names one", () => {
        const params = nested({
            llm: {model: "gpt-4o", provider: "openai", connection: {mode: "agenta", slug: "old"}},
        })
        const next = withModel(params, {
            modelId: "gpt-5",
            provider: "openai",
            mode: "self_managed",
            slug: null,
        })
        expect((next as any).agent.llm.connection).toEqual({mode: "self_managed"})
    })

    it("leaves the rest of the template untouched", () => {
        const next = withModel(nested(), {modelId: "gpt-5", provider: "openai"})
        expect((next as any).agent.harness).toEqual({
            kind: "pi_core",
            permissions: {allow: ["Read"]},
        })
        expect((next as any).agent.instructions).toEqual({agents_md: "hi"})
    })

    it("does not mutate the input", () => {
        const params = nested()
        withModel(params, {modelId: "gpt-5", provider: "openai"})
        expect(params.agent.llm).toEqual({model: "gpt-4o", provider: "openai"})
    })

    it("returns null for a non-object or an empty model id", () => {
        expect(withModel(null, {modelId: "gpt-5", provider: "openai"})).toBeNull()
        expect(withModel(nested(), {modelId: "", provider: "openai"})).toBeNull()
    })
})

describe("withHarnessKind", () => {
    it("sets the kind and preserves the harness permissions", () => {
        const next = withHarnessKind(nested(), "claude")
        expect((next as any).agent.harness).toEqual({
            kind: "claude",
            permissions: {allow: ["Read"]},
        })
    })

    it("creates the harness section when the template has none", () => {
        const next = withHarnessKind({agent: {llm: {model: "gpt-4o"}}}, "codex")
        expect((next as any).agent.harness).toEqual({kind: "codex"})
    })

    it("leaves the model alone — the caller owns the fallback", () => {
        const next = withHarnessKind(nested(), "claude")
        expect((next as any).agent.llm).toEqual({model: "gpt-4o", provider: "openai"})
    })

    it("composes with withModel for a harness switch that strands the model", () => {
        const switched = withHarnessKind(nested(), "claude")
        const next = withModel(switched, {
            modelId: "claude-sonnet-4-5",
            provider: "anthropic",
        })
        expect((next as any).agent.harness.kind).toBe("claude")
        expect((next as any).agent.llm.model).toBe("claude-sonnet-4-5")
    })

    it("returns null for a non-object or an empty kind", () => {
        expect(withHarnessKind(undefined, "claude")).toBeNull()
        expect(withHarnessKind(nested(), "")).toBeNull()
    })
})

describe("withRunnerPermission", () => {
    const withRules = (extra: Record<string, unknown> = {}) =>
        template({
            runner: {timeout: 30, permissions: {default: "allow_reads", rules: ["Read(*)"]}},
            ...extra,
        })

    it("sets the default policy under parameters.agent", () => {
        const next = withRunnerPermission({agent: withRules()}, "deny")
        expect((next as any).agent.runner.permissions.default).toBe("deny")
    })

    it("writes a bare template in place", () => {
        const next = withRunnerPermission(withRules(), "ask")
        expect((next as any).runner.permissions.default).toBe("ask")
        expect((next as any).agent).toBeUndefined()
    })

    // The panel picks a policy; rule editing stays in config, so the rules must survive it.
    it("preserves the rules list and the rest of the runner section", () => {
        const next = withRunnerPermission(withRules(), "allow")
        expect((next as any).runner.permissions.rules).toEqual(["Read(*)"])
        expect((next as any).runner.timeout).toBe(30)
    })

    it("creates the runner section when the template has none", () => {
        const next = withRunnerPermission(template(), "allow")
        expect((next as any).runner.permissions).toEqual({default: "allow"})
    })

    it("leaves the rest of the template alone", () => {
        const next = withRunnerPermission(withRules(), "deny")
        expect((next as any).llm).toEqual({model: "gpt-4o", provider: "openai"})
        expect((next as any).harness).toEqual({kind: "pi_core", permissions: {allow: ["Read"]}})
    })

    it("refuses a policy outside the four", () => {
        expect(withRunnerPermission(withRules(), "yolo")).toBeNull()
        expect(withRunnerPermission(withRules(), "")).toBeNull()
    })

    it("refuses a non-object parameters", () => {
        expect(withRunnerPermission(null, "deny")).toBeNull()
        expect(withRunnerPermission("nope", "deny")).toBeNull()
    })
})

describe("readers", () => {
    it("reads the runner permission from both shapes", () => {
        const runner = {runner: {permissions: {default: "ask"}}}
        expect(readRunnerPermission({agent: template(runner)})).toBe("ask")
        expect(readRunnerPermission(template(runner))).toBe("ask")
    })

    it("returns null when no policy is stored, so the caller can apply the default", () => {
        expect(readRunnerPermission(template())).toBeNull()
        expect(readRunnerPermission(template({runner: {}}))).toBeNull()
        expect(
            readRunnerPermission(template({runner: {permissions: {default: "bogus"}}})),
        ).toBeNull()
    })

    it("reads the model and harness from both shapes", () => {
        expect(readModelId(nested())).toBe("gpt-4o")
        expect(readModelId(template())).toBe("gpt-4o")
        expect(readHarnessKind(nested())).toBe("pi_core")
        expect(readHarnessKind(template())).toBe("pi_core")
    })

    it("reads a legacy bare-string model", () => {
        expect(readModelId({agent: {llm: "gpt-4o-mini"}})).toBe("gpt-4o-mini")
    })

    it("returns null when the field is absent", () => {
        expect(readModelId({agent: {}})).toBeNull()
        expect(readHarnessKind({agent: {}})).toBeNull()
    })
})
