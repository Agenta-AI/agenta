import type {ToolConnection} from "@agenta/entities/gatewayTool"
import {parseGatewayConnection} from "@agenta/entity-ui/tool-utils"
import {describe, expect, it} from "vitest"

import {onboardingConfiguration} from "@/features/onboarding/onboardingConfig"

const connected = (id: string, integration = "github", slug: string | null = id) =>
    ({
        id,
        slug,
        provider_key: "composio",
        integration_key: integration,
        flags: {is_active: true, is_valid: true},
    }) as ToolConnection

const write = (
    configuration: Record<string, unknown>,
    connections: ToolConnection[],
    apps: string[] = ["github", "slack"],
    instructions = "",
) => onboardingConfiguration(configuration, {instructions, apps, connections})

describe("onboarding agent configuration", () => {
    it("adds the chosen apps where the agent runner reads its tools", () => {
        const base = {agent: {llm: "model", tools: [{type: "custom"}]}, unrelated: "keep"}
        const result = write(base, [connected("gh"), connected("sl", "slack")])
        const agent = result.agent as {tools: unknown[]; llm: string}
        expect(agent.llm).toBe("model")
        expect(result.unrelated).toBe("keep")
        expect(agent.tools).toHaveLength(3)
        expect(parseGatewayConnection(agent.tools[1])).toEqual({
            provider: "composio",
            integration: "github",
            connection: "gh",
            permissions: {default: "allow", tools: {}},
        })
        expect(base.agent.tools).toHaveLength(1)
    })

    it("always adds the zero-auth tools and leaves unchosen apps out", () => {
        const tools = write({}, [connected("search", "composio_search"), connected("gh")], [])
            .tools as unknown[]
        expect(tools.map((tool) => parseGatewayConnection(tool)?.integration)).toEqual([
            "composio_search",
        ])
    })

    it("replaces earlier gateway tools on retry and never duplicates an integration", () => {
        const first = write({}, [connected("one"), connected("two")])
        expect(first.tools).toHaveLength(1)
        expect(write(first, []).tools).toEqual([])
    })

    it("leaves out revoked, invalid, and incomplete connections", () => {
        const unusable = [
            {...connected("revoked"), flags: {is_active: false, is_valid: true}},
            {...connected("invalid"), flags: {is_active: true, is_valid: false}},
            connected("no-slug", "github", null),
            {...connected("no-provider"), provider_key: null},
        ] as ToolConnection[]
        expect(write({}, unusable).tools).toEqual([])
    })

    it("writes the instructions into the agent's AGENTS.md and keeps the rest of the block", () => {
        const base = {agent: {instructions: {agents_md: "Default", files: ["a.md"]}}}
        const agent = write(base, [], [], "Be brief.").agent as {
            instructions: Record<string, unknown>
        }
        expect(agent.instructions).toEqual({agents_md: "Be brief.", files: ["a.md"]})
        expect(write(base, [], [], "").agent).toMatchObject({
            instructions: {agents_md: "Default"},
        })
    })
})
