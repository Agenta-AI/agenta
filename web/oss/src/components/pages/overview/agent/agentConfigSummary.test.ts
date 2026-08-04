import {describe, expect, it} from "vitest"

import {agentConfigSummary, prettifyKind} from "./agentConfigSummary"

// The shape below is a real stored revision's `parameters`, trimmed.
const parameters = {
    agent: {
        llm: {model: "gpt-5.6-luna", provider: "openai"},
        mcps: [],
        tools: [{name: "bash"}, {name: "read"}],
        runner: {kind: "sidecar", permissions: {default: "allow_reads"}},
        harness: {kind: "pi_core"},
        sandbox: {kind: "local"},
        instructions: {agents_md: "You are a friendly agent.\n\n- Greet the user warmly."},
    },
}

describe("agentConfigSummary", () => {
    it("reads the facts a row can state", () => {
        // 10 words, not 9: the markdown bullet counts. This is "how long is the brief", not billing.
        expect(agentConfigSummary(parameters)).toEqual({
            model: "gpt-5.6-luna",
            harness: "Pi core",
            instructionWords: 10,
            instructionPreview: "You are a friendly agent. - Greet the user warmly.",
            tools: 2,
            mcps: 0,
            skills: 0,
            sandbox: "Local",
            permissions: "Allow reads",
        })
    })

    it("accepts the agent object directly, not just the parameters wrapper", () => {
        expect(agentConfigSummary(parameters.agent).model).toBe("gpt-5.6-luna")
    })

    it("reports absence rather than throwing", () => {
        // A revision written before a field existed, or an agent that never set one.
        for (const input of [undefined, null, {}, {agent: {}}, "nonsense", []]) {
            const summary = agentConfigSummary(input)
            expect(summary.model).toBeNull()
            expect(summary.harness).toBeNull()
            expect(summary.instructionWords).toBeNull()
            expect(summary.tools).toBe(0)
        }
    })

    it("counts only real words in the brief", () => {
        expect(
            agentConfigSummary({agent: {instructions: {agents_md: "  one   two \n three "}}})
                .instructionWords,
        ).toBe(3)
        expect(
            agentConfigSummary({agent: {instructions: {agents_md: "   "}}}).instructionWords,
        ).toBeNull()
    })

    it("flattens the brief for a two-line preview", () => {
        // A markdown list would otherwise spend both preview lines on its first bullet.
        expect(
            agentConfigSummary({agent: {instructions: {agents_md: "Title\n\n- one\n- two"}}})
                .instructionPreview,
        ).toBe("Title - one - two")
        expect(agentConfigSummary({}).instructionPreview).toBeNull()
    })

    it("does not invent friendly names for kinds it doesn't know", () => {
        expect(prettifyKind("claude_code")).toBe("Claude code")
        expect(prettifyKind("some-future-kind")).toBe("Some future kind")
        expect(prettifyKind(null)).toBeNull()
    })
})
