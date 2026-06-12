/**
 * Unit tests for `collectDownstreamReferencedColumns`.
 *
 * Regression (#4525): the primary app's strict row clean dropped a testcase
 * column an LLM-as-a-judge referenced only through its prompt template (e.g.
 * `{{guidelines.rubric}}`), because the protected-column collector looked only
 * at `<input>_key` settings. The evaluator then ran without `guidelines`.
 *
 * The config source (the workflow molecule) is mocked so the test stays a pure
 * function check. The template-variable extraction is the real implementation.
 */
import {describe, expect, it, vi} from "vitest"

// `configuration(entityId)` returns a token the fake getter resolves to a
// config. This avoids standing up a jotai store with a hydrated workflow.
vi.mock("@agenta/entities/workflow", () => ({
    workflowMolecule: {
        selectors: {
            configuration: (entityId: string) => ({__configFor: entityId}),
        },
    },
}))

import {collectDownstreamReferencedColumns} from "../../src/state/helpers/entityInputContract"

interface TestNode {
    depth: number
    entityId: string
}

function makeGet(configByEntity: Record<string, Record<string, unknown> | null>) {
    return ((token: unknown) => {
        const entityId = (token as {__configFor?: string} | null)?.__configFor
        return entityId ? (configByEntity[entityId] ?? null) : null
    }) as Parameters<typeof collectDownstreamReferencedColumns>[0]
}

/**
 * An LLM-as-a-judge config in the nested shape `nestEvaluatorConfiguration`
 * produces: the prompt lives under `prompt.messages` with its own
 * `template_format`.
 */
function llmJudgeConfig(
    promptText: string,
    extra: Record<string, unknown> = {},
    templateFormat = "mustache",
): Record<string, unknown> {
    return {
        prompt: {
            messages: [{role: "user", content: promptText}],
            template_format: templateFormat,
            llm_config: {model: "gpt-4o"},
        },
        feedback_config: {type: "json_schema"},
        ...extra,
    }
}

describe("collectDownstreamReferencedColumns", () => {
    it("protects a column the evaluator references only through its prompt", () => {
        const nodes: TestNode[] = [
            {depth: 0, entityId: "app"},
            {depth: 1, entityId: "judge"},
        ]
        const get = makeGet({
            judge: llmJudgeConfig("Score the answer using {{guidelines.rubric}}."),
        })

        const columns = collectDownstreamReferencedColumns(get, nodes)

        // Root column, not the dotted path — the testcase column is `guidelines`.
        expect(columns.has("guidelines")).toBe(true)
        expect(columns.has("guidelines.rubric")).toBe(false)
    })

    it("still protects columns mapped through `<input>_key` settings", () => {
        const nodes: TestNode[] = [{depth: 1, entityId: "judge"}]
        const get = makeGet({
            judge: llmJudgeConfig("Compare to the reference.", {
                correct_answer_key: "ground_truth",
            }),
        })

        const columns = collectDownstreamReferencedColumns(get, nodes)

        expect(columns.has("ground_truth")).toBe(true)
    })

    it("strips the `testcase.` prefix on `<input>_key` values", () => {
        const nodes: TestNode[] = [{depth: 1, entityId: "judge"}]
        const get = makeGet({
            judge: llmJudgeConfig("Compare to the reference.", {
                correct_answer_key: "testcase.expected",
            }),
        })

        const columns = collectDownstreamReferencedColumns(get, nodes)

        expect(columns.has("expected")).toBe(true)
    })

    it("collects both prompt-referenced and `_key`-mapped columns together", () => {
        const nodes: TestNode[] = [{depth: 1, entityId: "judge"}]
        const get = makeGet({
            judge: llmJudgeConfig("Use {{guidelines.rubric}} and {{context}}.", {
                correct_answer_key: "ground_truth",
            }),
        })

        const columns = collectDownstreamReferencedColumns(get, nodes)

        expect([...columns].sort()).toEqual(["context", "ground_truth", "guidelines"])
    })

    it("does not protect runtime-injected reserved names", () => {
        const nodes: TestNode[] = [{depth: 1, entityId: "judge"}]
        const get = makeGet({
            judge: llmJudgeConfig(
                "Judge {{prediction}} vs {{outputs}}, given {{inputs}} and {{messages}}.",
            ),
        })

        const columns = collectDownstreamReferencedColumns(get, nodes)

        // prediction/outputs are the upstream output, inputs is the testcase
        // object, messages is chat transport — none is a testcase column.
        expect(columns.size).toBe(0)
    })

    it("keeps a curly dotted reference as the literal column name", () => {
        const nodes: TestNode[] = [{depth: 1, entityId: "judge"}]
        const get = makeGet({
            // Legacy curly judge: `{{guidelines.rubric}}` names a literal column.
            judge: llmJudgeConfig("Score with {{guidelines.rubric}}.", {}, "curly"),
        })

        const columns = collectDownstreamReferencedColumns(get, nodes)

        expect(columns.has("guidelines.rubric")).toBe(true)
        expect(columns.has("guidelines")).toBe(false)
    })

    it("ignores the depth-0 primary node", () => {
        const nodes: TestNode[] = [{depth: 0, entityId: "app"}]
        const get = makeGet({
            app: llmJudgeConfig("{{guidelines.rubric}}"),
        })

        const columns = collectDownstreamReferencedColumns(get, nodes)

        expect(columns.size).toBe(0)
    })

    it("returns an empty set when a node has no config", () => {
        const nodes: TestNode[] = [{depth: 1, entityId: "judge"}]
        const get = makeGet({judge: null})

        const columns = collectDownstreamReferencedColumns(get, nodes)

        expect(columns.size).toBe(0)
    })
})
