/**
 * Unit tests for revision-delta preview (applyRevisionDelta + classifyRevisionDeltaChanges).
 * Semantics must mirror the backend resolver: dicts merge, scalars/lists replace, remove
 * deletes dotted paths. Partial deltas must never report untouched sections as removed.
 */
import {describe, it, expect} from "vitest"

import {
    applyRevisionDelta,
    classifyRevisionDeltaChanges,
} from "../../src/workflow/commitDiff/revisionDelta"

const tool = (name: string, description = "Search") => ({
    type: "function",
    function: {
        name,
        description,
        parameters: {type: "object", properties: {query: {type: "string"}}},
    },
})

const currentParams = {
    agent: {
        instructions: {agents_md: "You are a hello-world agent."},
        llm: {provider: "openai", model: "gpt-4o", temperature: 0.7},
        tools: [tool("gmail_search"), {type: "platform", op: "commit_revision"}],
        skills: [],
    },
}

describe("applyRevisionDelta — backend merge semantics", () => {
    it("deep-merges dicts and leaves sibling keys intact", () => {
        const data = applyRevisionDelta(
            {parameters: currentParams},
            {set: {parameters: {agent: {llm: {model: "gpt-5"}}}}},
        )
        const agent = (data.parameters as typeof currentParams).agent
        expect(agent.llm.model).toBe("gpt-5")
        expect(agent.llm.temperature).toBe(0.7)
        expect(agent.instructions.agents_md).toBe("You are a hello-world agent.")
    })

    it("replaces lists wholesale (no identity merge)", () => {
        const data = applyRevisionDelta(
            {parameters: currentParams},
            {set: {parameters: {agent: {tools: [tool("slack_post")]}}}},
        )
        const agent = (data.parameters as typeof currentParams).agent
        expect(agent.tools).toHaveLength(1)
    })

    it("remove deletes dotted paths; missing paths are a no-op", () => {
        const data = applyRevisionDelta(
            {parameters: currentParams},
            {remove: ["parameters.agent.tools", "parameters.agent.nope.deeper"]},
        )
        const agent = (data.parameters as Record<string, Record<string, unknown>>).agent
        expect("tools" in agent).toBe(false)
        expect(agent.llm).toBeDefined()
    })

    it("does not mutate the base object", () => {
        const before = JSON.stringify(currentParams)
        applyRevisionDelta(
            {parameters: currentParams},
            {set: {parameters: {agent: {llm: {model: "x"}}}}, remove: ["parameters.agent.skills"]},
        )
        expect(JSON.stringify(currentParams)).toBe(before)
    })

    it("treats __proto__ as a literal own key, like the backend's dict assignment", () => {
        // JSON.parse yields an own `__proto__` key; plain `obj[key] =` would hit the setter.
        const delta = JSON.parse(
            '{"set": {"parameters": {"__proto__": {"polluted": true}}}, "remove": ["parameters.__proto__.nope"]}',
        ) as {set: Record<string, unknown>; remove: string[]}
        const data = applyRevisionDelta({parameters: {}}, delta)
        const params = data.parameters as Record<string, unknown>
        expect(Object.getPrototypeOf(params)).toBe(Object.prototype)
        expect(Object.prototype.hasOwnProperty.call(params, "__proto__")).toBe(true)
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })
})

describe("classifyRevisionDeltaChanges — sections for a partial delta", () => {
    it("instructions-only delta yields only an edited Instructions section", () => {
        const preview = classifyRevisionDeltaChanges(currentParams, {
            set: {parameters: {agent: {instructions: {agents_md: "You are concise."}}}},
        })
        expect(preview).not.toBeNull()
        const ids = preview!.sections.map((s) => s.id)
        expect(ids).toEqual(["instructions"])
        expect(preview!.sections[0].tags[0].kind).toBe("edited")
    })

    it("tool list replacement classifies adds and removals", () => {
        const preview = classifyRevisionDeltaChanges(currentParams, {
            set: {
                parameters: {
                    agent: {
                        tools: [
                            tool("gmail_search"),
                            {type: "platform", op: "commit_revision"},
                            tool("slack_post"),
                        ],
                    },
                },
            },
        })
        const tools = preview!.sections.find((s) => s.id === "tools")
        expect(tools?.tags).toEqual([{kind: "added", label: "1 added"}])
    })

    it("returns null for malformed, empty, or no-op deltas", () => {
        expect(classifyRevisionDeltaChanges(currentParams, null)).toBeNull()
        expect(classifyRevisionDeltaChanges(currentParams, "nope")).toBeNull()
        expect(classifyRevisionDeltaChanges(currentParams, {})).toBeNull()
        // Setting the same value changes nothing → no sections → null.
        expect(
            classifyRevisionDeltaChanges(currentParams, {
                set: {parameters: {agent: {llm: {model: "gpt-4o"}}}},
            }),
        ).toBeNull()
    })

    it("proposedParams carries the post-commit parameters", () => {
        const preview = classifyRevisionDeltaChanges(currentParams, {
            set: {parameters: {agent: {llm: {model: "gpt-5"}}}},
        })
        const agent = preview!.proposedParams.agent as {llm: {model: string}}
        expect(agent.llm.model).toBe("gpt-5")
    })

    // The backend commits the delta onto the WHOLE revision data tree; the preview only
    // renders `parameters`. Anything out of scope must fall back to the raw payload —
    // never a partial summary that hides the rest of the commit.
    it("returns null when set reaches outside parameters, even alongside a parameters edit", () => {
        expect(
            classifyRevisionDeltaChanges(currentParams, {
                set: {
                    parameters: {agent: {instructions: {agents_md: "You are concise."}}},
                    url: "https://evil.example/hook",
                },
            }),
        ).toBeNull()
        expect(
            classifyRevisionDeltaChanges(currentParams, {set: {script: "print('hi')"}}),
        ).toBeNull()
    })

    it("returns null when remove targets a path outside parameters", () => {
        expect(
            classifyRevisionDeltaChanges(currentParams, {
                set: {parameters: {agent: {instructions: {agents_md: "You are concise."}}}},
                remove: ["url"],
            }),
        ).toBeNull()
        // `parametersX` must not pass as a prefix match.
        expect(
            classifyRevisionDeltaChanges(currentParams, {remove: ["parametersX.agent"]}),
        ).toBeNull()
    })

    it("still previews parameters-scoped removes", () => {
        const preview = classifyRevisionDeltaChanges(currentParams, {
            remove: ["parameters.agent.tools"],
        })
        expect(preview).not.toBeNull()
        expect("tools" in (preview!.proposedParams.agent as Record<string, unknown>)).toBe(false)
    })
})
