/**
 * Unit tests for the entity input contract helpers.
 *
 * `collectDownstreamReferencedColumns` regression (#4525): the primary app's
 * strict row clean dropped a testcase column an LLM-as-a-judge referenced only
 * through its prompt template (e.g. `{{guidelines.rubric}}`), because the
 * protected-column collector looked only at `<input>_key` settings. The
 * evaluator then ran without `guidelines`.
 *
 * `collectTestcaseServerColumns` regression (#4647): the strict row clean
 * deleted a synced test set's columns the prompt didn't reference, emptying
 * the "unused testcase columns" footer on Run. The server snapshot's columns
 * are intentional data and must survive the clean.
 *
 * The atom sources (workflow + testcase molecules) are mocked so the tests
 * stay pure function checks: each selector returns a token the fake getter
 * resolves against fixtures. The template-variable extraction is the real
 * implementation.
 */
import {describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/workflow", () => ({
    workflowMolecule: {
        selectors: {
            configuration: (entityId: string) => ({__configFor: entityId}),
            data: (entityId: string) => ({__dataFor: entityId}),
            executionMode: (entityId: string) => ({__modeFor: entityId}),
            inputPorts: (entityId: string) => ({__portsFor: entityId}),
            requestPayload: (entityId: string) => ({__payloadFor: entityId}),
        },
    },
}))

// Keep the real module (other packages in the import graph use
// `testcaseMolecule.atoms`); only `serverData` returns a token the fake
// getter resolves against fixtures. `isSystemField` stays the real one.
vi.mock("@agenta/entities/testcase", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/entities/testcase")>()
    return {
        ...actual,
        testcaseMolecule: {
            ...actual.testcaseMolecule,
            selectors: {
                ...actual.testcaseMolecule.selectors,
                serverData: (rowId: string) => ({__serverDataFor: rowId}),
            },
        },
    }
})

import {
    collectDownstreamReferencedColumns,
    collectTestcaseServerColumns,
    reconcileRowDataForEntity,
} from "../../src/state/helpers/entityInputContract"

interface TestNode {
    depth: number
    entityId: string
}

interface GetterFixtures {
    serverDataByRow?: Record<string, {data?: Record<string, unknown> | null} | null>
    entityById?: Record<string, unknown>
    modeById?: Record<string, "chat" | "completion">
    portsById?: Record<string, {key?: string}[]>
    payloadById?: Record<string, unknown>
}

function makeGet(
    configByEntity: Record<string, Record<string, unknown> | null>,
    fixtures: GetterFixtures = {},
) {
    return ((token: unknown) => {
        const t = token as Record<string, string | undefined> | null
        if (!t) return null
        if (t.__configFor) return configByEntity[t.__configFor] ?? null
        if (t.__serverDataFor) return fixtures.serverDataByRow?.[t.__serverDataFor] ?? null
        if (t.__dataFor) return fixtures.entityById?.[t.__dataFor] ?? null
        if (t.__modeFor) return fixtures.modeById?.[t.__modeFor]
        if (t.__portsFor) return fixtures.portsById?.[t.__portsFor] ?? []
        if (t.__payloadFor) return fixtures.payloadById?.[t.__payloadFor] ?? null
        return null
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

describe("collectTestcaseServerColumns", () => {
    it("returns the connected test set's non-system columns", () => {
        const get = makeGet(
            {},
            {
                serverDataByRow: {
                    tc1: {
                        data: {
                            country: "France",
                            capital: "Paris",
                            id: "tc1",
                            testset_id: "ts1",
                            created_at: "2026-06-01",
                        },
                    },
                },
            },
        )

        const columns = collectTestcaseServerColumns(get, "tc1")

        expect([...columns].sort()).toEqual(["capital", "country"])
    })

    it("excludes chat transport keys so the chat-to-completion strip is preserved", () => {
        const get = makeGet(
            {},
            {
                serverDataByRow: {
                    tc1: {data: {messages: [{role: "user", content: "hi"}], country: "France"}},
                },
            },
        )

        const columns = collectTestcaseServerColumns(get, "tc1")

        expect(columns.has("messages")).toBe(false)
        expect(columns.has("country")).toBe(true)
    })

    it("returns an empty set when the row has no server data (local row)", () => {
        const get = makeGet({}, {serverDataByRow: {tc1: null}})

        expect(collectTestcaseServerColumns(get, "tc1").size).toBe(0)
    })

    it("returns an empty set for a missing row id", () => {
        const get = makeGet({})

        expect(collectTestcaseServerColumns(get, undefined).size).toBe(0)
        expect(collectTestcaseServerColumns(get, null).size).toBe(0)
    })
})

describe("reconcileRowDataForEntity with protected server columns", () => {
    const completionAppFixtures: GetterFixtures = {
        entityById: {app: {flags: {}}},
        modeById: {app: "completion" as const},
        portsById: {app: [{key: "country"}]},
    }

    it("keeps protected server columns and still drops stale local keys", () => {
        const get = makeGet(
            {},
            {
                ...completionAppFixtures,
                serverDataByRow: {tc1: {data: {country: "France", capital: "Paris"}}},
            },
        )
        const serverColumns = collectTestcaseServerColumns(get, "tc1")

        const result = reconcileRowDataForEntity(
            get,
            "app",
            {
                country: "France",
                capital: "Paris",
                // Stale local key from a previously selected chat app — not in
                // the server snapshot, so it must still be cleaned (#4525).
                messages: [{role: "user", content: "hi"}],
            },
            {protectedKeys: serverColumns},
        )

        expect(result.strategy).toBe("strict")
        expect(result.dropped).toEqual(["messages"])
        expect(result.data).toEqual({country: "France", capital: "Paris"})
    })

    it("drops unreferenced columns when the row has no server snapshot", () => {
        const get = makeGet({}, completionAppFixtures)
        const serverColumns = collectTestcaseServerColumns(get, "local-1")

        const result = reconcileRowDataForEntity(
            get,
            "app",
            {country: "France", capital: "Paris"},
            {protectedKeys: serverColumns},
        )

        expect(result.dropped).toEqual(["capital"])
    })

    it("keeps messages for a chat app through allowedKeys, not protection", () => {
        const get = makeGet(
            {},
            {
                entityById: {app: {flags: {}}},
                modeById: {app: "chat" as const},
                portsById: {app: [{key: "country"}]},
            },
        )

        const result = reconcileRowDataForEntity(get, "app", {
            country: "France",
            messages: [{role: "user", content: "hi"}],
        })

        expect(result.dropped).toEqual([])
    })
})
