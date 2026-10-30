import {describe, expect, it} from "vitest"

import {
    agentRequirementsSchema,
    canFixRequirement,
    isPersonalRequirement,
    modelRequirement,
    needsSetupReasonLabel,
    requirementAtPath,
    requirementForItem,
    type AgentRequirementItem,
} from "../../src/workflow/requirements"

const req = (over: Partial<AgentRequirementItem>): AgentRequirementItem => ({
    key: "x",
    kind: "mcp_server",
    label: "x",
    reference: {},
    paths: [],
    reason: "not_found",
    blocks_run: false,
    ...over,
})

const github = req({
    key: "app_connection:github/github-x1",
    kind: "app_connection",
    reference: {provider: "composio", integration: "github", slug: "github-x1"},
    paths: ["agent.tools[2].connection", "agent.tools[3].connection"],
})
const linear = req({
    key: "mcp_sign_in:linear",
    kind: "mcp_sign_in",
    reference: {slug: "linear"},
    paths: ["agent.mcps[0].connection"],
    reason: "needs_sign_in",
    fix: {can_edit_agent: false, can_sign_in: true},
})
const model = req({
    key: "model:openai/gpt-5.5",
    kind: "model",
    reference: {provider: "openai", model: "gpt-5.5"},
    paths: ["agent.llm.model"],
    reason: "not_available",
    blocks_run: true,
    fix: {can_edit_agent: true},
})
const list = [github, linear, model]

describe("requirementAtPath", () => {
    it("matches every path of one item, relative to the agent template", () => {
        expect(requirementAtPath(list, "tools[2]")).toBe(github)
        expect(requirementAtPath(list, "tools[3]")).toBe(github)
        expect(requirementAtPath(list, "mcps[0]")).toBe(linear)
        expect(requirementAtPath(list, "llm")).toBe(model)
    })

    it("does not match a sibling index that shares a prefix", () => {
        expect(requirementAtPath(list, "tools[1]")).toBeUndefined()
        expect(requirementAtPath([req({paths: ["agent.tools[12].connection"]})], "tools[1]")).toBe(
            undefined,
        )
    })
})

describe("requirementForItem", () => {
    it("matches by kind and slug", () => {
        expect(
            requirementForItem(list, {kinds: ["mcp_server", "mcp_sign_in"], slug: "linear"}),
        ).toBe(linear)
        expect(requirementForItem(list, {kinds: ["secret"], slug: "linear"})).toBeUndefined()
    })

    it("checks the integration when both sides name one", () => {
        expect(
            requirementForItem(list, {
                kinds: ["app_connection"],
                slug: "github-x1",
                integration: "github",
            }),
        ).toBe(github)
        expect(
            requirementForItem(list, {
                kinds: ["app_connection"],
                slug: "github-x1",
                integration: "gmail",
            }),
        ).toBeUndefined()
    })

    it("never matches an item with no slug", () => {
        expect(requirementForItem(list, {kinds: ["app_connection"], slug: null})).toBeUndefined()
    })
})

describe("modelRequirement", () => {
    it("returns the first requirement that blocks a run", () => {
        expect(modelRequirement(list)).toBe(model)
        expect(modelRequirement([github, linear])).toBeUndefined()
    })
})

describe("needsSetupReasonLabel and canFixRequirement", () => {
    it("words known reasons and drops unknown ones", () => {
        expect(needsSetupReasonLabel("not_available")).toBe("No longer available")
        expect(needsSetupReasonLabel("needs_sign_in")).toBe("Sign-in expired")
        expect(needsSetupReasonLabel("needs_your_account")).toBeNull()
    })

    it("lets a viewer act only with edit or sign-in rights", () => {
        expect(canFixRequirement(model)).toBe(true)
        expect(canFixRequirement(linear)).toBe(true)
        expect(canFixRequirement(github)).toBe(false)
    })
})

describe("agentRequirementsSchema", () => {
    it("accepts a reason this client does not know yet", () => {
        const parsed = agentRequirementsSchema.safeParse({
            count: 1,
            status: "needs_setup",
            requirements: [{...github, reason: "needs_your_account"}],
        })
        expect(parsed.success).toBe(true)
    })
})

describe("user items", () => {
    const userGmail = req({
        key: "app_connection:user/gmail",
        kind: "app_connection",
        account_source: "user",
        reference: {provider: "composio", integration: "gmail", account_source: "user"},
        paths: ["agent.tools[0].connection"],
        reason: "needs_personal_account",
        fix: {can_connect: true, candidates: 2},
    })
    const userLinear = req({
        key: "mcp_sign_in:user/linear",
        kind: "mcp_sign_in",
        account_source: "user",
        reference: {slug: "linear", account_source: "user"},
        paths: ["agent.mcps[1].connection"],
        reason: "needs_sign_in",
        fix: {can_sign_in: true},
    })

    it("are never the editor row's problem", () => {
        expect(requirementAtPath([userGmail], "tools[0]")).toBeUndefined()
        expect(
            requirementForItem([userLinear], {
                kinds: ["mcp_server", "mcp_sign_in"],
                slug: "linear",
            }),
        ).toBeUndefined()
    })

    it("are told apart by account_source, not by the key", () => {
        expect(isPersonalRequirement(userGmail)).toBe(true)
        expect(isPersonalRequirement(github)).toBe(false)
    })

    // The project's server is missing: no sign-in fixes it, so the editor row shows it.
    const userMissingServer = req({
        key: "mcp_server:user/octolens",
        kind: "mcp_server",
        account_source: "user",
        reference: {type: "gateway", namespace: "custom", slug: "octolens"},
        paths: ["agent.mcps[2].connection"],
        reason: "not_found",
        fix: {can_edit_agent: true},
    })

    it("are the agent's problem when the project's server is missing", () => {
        expect(isPersonalRequirement(userMissingServer)).toBe(false)
        expect(requirementAtPath([userMissingServer], "mcps[2]")).toBe(userMissingServer)
        expect(
            requirementForItem([userMissingServer], {kinds: ["mcp_server"], slug: "octolens"}),
        ).toBe(userMissingServer)
    })
})
