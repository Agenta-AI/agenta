/**
 * Unit tests for `createEphemeralWorkflow` — focused on the URI derivation
 * added for issue #4426 problem 2a.
 *
 * Without a `uri` on the ephemeral entity, the playground config panel
 * cannot fetch the workflow schema and falls back to the empty
 * "No configuration needed" state. The constructor now defaults to the
 * agenta-managed `completion` / `chat` builtin URIs (driven by the
 * detected chat mode) so the schema fetch succeeds and the trace's
 * parameters render against a real form.
 */

import {describe, expect, it} from "vitest"

import {createEphemeralWorkflow} from "../../src/workflow/state/store"

describe("createEphemeralWorkflow — URI derivation (issue #4426 problem 2a)", () => {
    it("defaults non-evaluator non-chat ephemerals to the completion builtin URI", () => {
        const {data} = createEphemeralWorkflow({
            label: "trace replay",
            inputs: {country: "France"},
            outputs: {capital: "Paris"},
            parameters: {model: "gpt-4"},
        })
        expect(data.data?.uri).toBe("agenta:builtin:completion:v0")
    })

    it("defaults non-evaluator chat ephemerals to the chat builtin URI", () => {
        const chatInputs = {
            messages: [
                {role: "user", content: "hello"},
                {role: "assistant", content: "hi"},
            ],
        }
        const {data} = createEphemeralWorkflow({
            label: "trace replay",
            inputs: chatInputs,
            outputs: {},
            parameters: {model: "gpt-4"},
        })
        expect(data.data?.uri).toBe("agenta:builtin:chat:v0")
    })

    it("respects an explicit caller-supplied URI", () => {
        // Evaluator path: openFromTrace passes the derived builtin URI for
        // evaluator spans (`deriveBuiltinUriFromSpanName`). The constructor
        // must not overwrite it with the completion/chat default.
        const {data} = createEphemeralWorkflow({
            label: "trace replay",
            inputs: {},
            outputs: {},
            parameters: {},
            isEvaluator: true,
            uri: "agenta:builtin:auto_ai_critique:v0",
        })
        expect(data.data?.uri).toBe("agenta:builtin:auto_ai_critique:v0")
    })

    it("omits URI for evaluator ephemerals without a caller-supplied URI", () => {
        // Evaluator spans without a derivable URI stay URI-less — the
        // evaluator runnable path handles that explicitly via meta.
        const {data} = createEphemeralWorkflow({
            label: "trace replay",
            inputs: {},
            outputs: {},
            parameters: {},
            isEvaluator: true,
        })
        expect(data.data?.uri).toBeUndefined()
    })

    it("keeps parameters intact on the ephemeral entity", () => {
        // Issue #4426 problem 2c — parameters extracted at openFromTrace
        // time must land on `data.parameters` so the config panel can
        // pre-fill them once the schema is available.
        const params = {temperature: 0.7, prompt: {messages: []}}
        const {data} = createEphemeralWorkflow({
            label: "trace replay",
            inputs: {},
            outputs: {},
            parameters: params,
        })
        expect(data.data?.parameters).toEqual(params)
    })
})
