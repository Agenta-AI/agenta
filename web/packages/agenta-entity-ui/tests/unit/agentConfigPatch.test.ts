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
    mergeAgentConfigDraft,
    readHarnessKind,
    readModelConnectionSlug,
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

describe("mergeAgentConfigDraft", () => {
    it("removes pruned baseline leaves without deleting new concurrent descendants", () => {
        const baseline = {sandbox: {kind: "local", nested: {removed: true}}}
        const live = {
            sandbox: {
                ...baseline.sandbox,
                permissions: {network: "off"},
                nested: {removed: true, added: {deny: ["write"]}},
            },
        }
        expect(mergeAgentConfigDraft(live, baseline, {})).toEqual({
            sandbox: {
                permissions: {network: "off"},
                nested: {added: {deny: ["write"]}},
            },
        })
        expect(mergeAgentConfigDraft(baseline, baseline, {})).toEqual({})
        expect(live.sandbox.nested.removed).toBe(true)
    })

    it("saves model routing atomically while preserving concurrent extras and hidden policies", () => {
        const baseline = template()
        const draft = {...baseline, llm: {...baseline.llm, model: "gpt-5"}}
        const live = {
            ...baseline,
            llm: {
                model: "sonnet",
                provider: "anthropic",
                connection: {mode: "self_managed"},
                extras: {seed: 2},
            },
            harness: {kind: "claude", permissions: {deny: ["Write"]}},
        }
        expect(mergeAgentConfigDraft(live, baseline, draft, "model-harness")).toEqual({
            ...live,
            llm: {model: "gpt-5", provider: "openai", extras: {seed: 2}},
            harness: {kind: "pi_core", permissions: {deny: ["Write"]}},
        })
        expect(mergeAgentConfigDraft(live, baseline, baseline, "model-harness")).toEqual(live)
    })

    it("keeps the buffered connection and model when only the harness changed in the drawer", () => {
        const baseline = template({
            llm: {model: "gpt-5", provider: "openai", connection: {mode: "agenta", slug: "chosen"}},
        })
        const draft = {...baseline, harness: {...baseline.harness, kind: "codex"}}
        const live = {...baseline, llm: {model: "sonnet", provider: "anthropic"}}
        expect(mergeAgentConfigDraft(live, baseline, draft, "model-harness").llm).toEqual(
            baseline.llm,
        )
    })
    it("keeps concurrent fields when a drawer adds a previously missing object", () => {
        const live = {
            runner: {permissions: {rules: ["deny"]}},
            sandbox: {permissions: {network: "off"}},
        }
        expect(mergeAgentConfigDraft(live, {}, {runner: {permissions: {default: "ask"}}})).toEqual({
            ...live,
            runner: {permissions: {rules: ["deny"], default: "ask"}},
        })
    })
    it("applies intentional deletions and array edits without reverting untouched siblings", () => {
        const baseline = {
            llm: {model: "old", connection: {slug: "old"}, extras: {seed: 1}},
            tools: ["old"],
        }
        const live = {
            ...baseline,
            llm: {...baseline.llm, extras: {seed: 2}},
            sandbox: {kind: "daytona"},
        }
        const draft = {llm: {model: "new", extras: {seed: 1}}, tools: ["new"]}
        expect(mergeAgentConfigDraft(live, baseline, draft)).toEqual({
            llm: {model: "new", extras: {seed: 2}},
            tools: ["new"],
            sandbox: {kind: "daytona"},
        })
        expect(baseline.llm.connection).toEqual({slug: "old"})
    })
})

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

    // The slug names a connection belonging to the OLD provider and the backend rejects a
    // provider/slug mismatch, so an unqualified pick must drop it — the drawer's writer nulls it
    // the same way. `agenta` with no slug IS the default connection, so the key collapses away.
    it("drops the stored connection slug when the patch does not name one", () => {
        const params = nested({
            llm: {
                model: "gpt-4o",
                provider: "openai",
                connection: {mode: "agenta", slug: "prod-key"},
            },
        })
        const next = withModel(params, {modelId: "gpt-5", provider: "openai"})
        expect((next as any).agent.llm.connection).toBeUndefined()
    })

    it("keeps a non-default mode while still dropping the slug", () => {
        const params = nested({
            llm: {
                model: "gpt-4o",
                provider: "openai",
                connection: {mode: "self_managed", slug: "prod-key"},
            },
        })
        const next = withModel(params, {modelId: "gpt-5", provider: "openai"})
        expect((next as any).agent.llm.connection).toEqual({mode: "self_managed"})
    })

    it("does not carry a named connection across a provider change", () => {
        const params = nested({
            llm: {
                model: "claude-sonnet-4-5",
                provider: "anthropic",
                connection: {mode: "self_managed", slug: "bedrock-prod"},
            },
        })
        const next = withModel(params, {modelId: "gpt-5", provider: "openai"})
        expect((next as any).agent.llm.provider).toBe("openai")
        expect((next as any).agent.llm.connection?.slug).toBeUndefined()
    })

    it("keeps a connection the caller explicitly supplies", () => {
        const params = nested({
            llm: {model: "gpt-4o", provider: "openai", connection: {mode: "agenta", slug: "old"}},
        })
        const next = withModel(params, {modelId: "gpt-5", provider: "openai", slug: "prod-key"})
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

    // The slug has to travel with the model id: `harnessAllowsModel` reports a vault-hosted model
    // as unavailable without it, which is the false "model not available" badge.
    it("reads the stored connection slug, and null when there is none", () => {
        const withConnection = nested({
            llm: {
                model: "custom-bedrock-model-id-123",
                provider: "anthropic",
                connection: {mode: "self_managed", slug: "my-bedrock"},
            },
        })
        expect(readModelConnectionSlug(withConnection)).toBe("my-bedrock")
        expect(readModelConnectionSlug(template())).toBeNull()
        expect(readModelConnectionSlug(null)).toBeNull()
    })

    it("reads a legacy bare-string model", () => {
        expect(readModelId({agent: {llm: "gpt-4o-mini"}})).toBe("gpt-4o-mini")
    })

    it("returns null when the field is absent", () => {
        expect(readModelId({agent: {}})).toBeNull()
        expect(readHarnessKind({agent: {}})).toBeNull()
    })
})
