import type {ToolConnection} from "@agenta/entities/gatewayTool"
import {parseGatewayConnection} from "@agenta/entity-ui/tool-utils"
import {describe, expect, it} from "vitest"

import {withOnboardingTools} from "@/features/onboarding/onboardingTools"

const connected = (id: string, integration = "github", slug: string | null = id) =>
    ({
        id,
        slug,
        provider_key: "composio",
        integration_key: integration,
        flags: {is_active: true, is_valid: true},
    }) as ToolConnection

describe("onboarding tool configuration", () => {
    it("adds every usable connection where the agent runner reads its tools", () => {
        const base = {agent: {llm: "model", tools: [{type: "custom"}]}, unrelated: "keep"}
        const result = withOnboardingTools(base, [connected("gh"), connected("sl", "slack")])
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

    it("replaces earlier gateway tools on retry and never duplicates an integration", () => {
        const first = withOnboardingTools({}, [connected("one"), connected("two")])
        expect(first.tools).toHaveLength(1)
        expect(withOnboardingTools(first, []).tools).toEqual([])
    })

    it("leaves out revoked, invalid, and incomplete connections", () => {
        const unusable = [
            {...connected("revoked"), flags: {is_active: false, is_valid: true}},
            {...connected("invalid"), flags: {is_active: true, is_valid: false}},
            connected("no-slug", "github", null),
            {...connected("no-provider"), provider_key: null},
        ] as ToolConnection[]
        expect(withOnboardingTools({}, unusable).tools).toEqual([])
    })
})
