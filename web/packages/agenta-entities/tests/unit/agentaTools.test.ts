import {describe, expect, it} from "vitest"

import {
    DEFAULT_AGENTA_TOOLS,
    readAgentaTools,
    withAgentaToolsEntry,
    writeAgentaTools,
} from "../../src/workflow/agentaTools"

const revision = (tools?: unknown[]) =>
    ({
        id: "rev-1",
        data: {
            uri: "agenta:builtin:agent:v0",
            parameters: {agent: {instructions: {agents_md: "hi"}, ...(tools ? {tools} : {})}},
        },
    }) as never

const toolsOf = (value: unknown) =>
    (value as {data: {parameters: {agent: {tools: unknown[]}}}}).data.parameters.agent.tools

describe("withAgentaToolsEntry", () => {
    it("adds the default entry to an agent saved without one", () => {
        const gateway = {type: "gateway_connection", connection: {integration: "github"}}
        expect(toolsOf(withAgentaToolsEntry(revision([gateway])))).toEqual([
            gateway,
            {type: "agenta_tools", tools: DEFAULT_AGENTA_TOOLS},
        ])
        expect(toolsOf(withAgentaToolsEntry(revision()))).toEqual([
            {type: "agenta_tools", tools: DEFAULT_AGENTA_TOOLS},
        ])
    })

    it("leaves an existing entry alone, even an empty one", () => {
        const empty = revision([{type: "agenta_tools", tools: {}}])
        expect(withAgentaToolsEntry(empty)).toBe(empty)
        const custom = revision([{type: "agenta_tools", tools: {create_schedule: "ask"}}])
        expect(withAgentaToolsEntry(custom)).toBe(custom)
    })

    it("leaves a workflow that is not an agent alone", () => {
        const prompt = {id: "rev-2", data: {parameters: {prompt: {}}}} as never
        expect(withAgentaToolsEntry(prompt)).toBe(prompt)
        expect(withAgentaToolsEntry(null)).toBeNull()
    })

    it("does not mutate the revision it was given", () => {
        const loaded = revision([])
        withAgentaToolsEntry(loaded)
        expect(toolsOf(loaded)).toEqual([])
    })
})

describe("readAgentaTools and writeAgentaTools", () => {
    it("reads the entry's map, or null when there is no entry", () => {
        expect(readAgentaTools([{type: "agenta_tools", tools: {rename_session: "ask"}}])).toEqual({
            rename_session: "ask",
        })
        expect(readAgentaTools([{type: "platform", op: "rename_session"}])).toBeNull()
    })

    it("replaces the entry's map in place and keeps an empty map", () => {
        const other = {type: "platform", op: "read_config"}
        const tools = [{type: "agenta_tools", tools: DEFAULT_AGENTA_TOOLS}, other]
        expect(writeAgentaTools(tools, {})).toEqual([{type: "agenta_tools", tools: {}}, other])
    })
})
