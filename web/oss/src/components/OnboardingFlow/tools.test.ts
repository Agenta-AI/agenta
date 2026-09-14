import type {ToolConnection} from "@agenta/entities/gatewayTool"
import {parseGatewayConnection} from "@agenta/entity-ui/tool-utils"
import {describe, expect, it} from "vitest"

import {withOnboardingTools} from "./tools"

const connected = (id: string, slug = id): ToolConnection =>
    ({
        id,
        slug,
        provider_key: "composio",
        integration_key: "github",
        flags: {is_active: true, is_valid: true},
    }) as ToolConnection

describe("onboarding tool configuration", () => {
    it("attaches only selected connections where the agent runner reads them", () => {
        const base = {agent: {llm: "model", tools: [{type: "custom"}]}, unrelated: "keep"}
        const result = withOnboardingTools(
            base,
            [connected("chosen"), connected("other")],
            ["chosen"],
        )
        const agent = result.agent as {tools: unknown[]; llm: string}
        expect(agent.llm).toBe("model")
        expect(result.unrelated).toBe("keep")
        expect(agent.tools).toHaveLength(2)
        expect(parseGatewayConnection(agent.tools[1])).toEqual({
            provider: "composio",
            integration: "github",
            connection: "chosen",
            permissions: {default: "allow", tools: {}},
        })
        expect(base.agent.tools).toHaveLength(1)
    })
    it("replaces an earlier selection on retry and never duplicates an integration", () => {
        const first = withOnboardingTools({}, [connected("one"), connected("two")], ["one", "two"])
        expect(first.tools).toHaveLength(1)
        expect(withOnboardingTools(first, [], []).tools).toEqual([])
    })
    it("rejects missing, revoked, invalid, and incomplete connection references", () => {
        expect(() => withOnboardingTools({}, [], ["missing"])).toThrow(/reconnecting/)
        for (const connection of [
            {...connected("bad"), flags: {is_active: false, is_valid: true}},
            {...connected("bad"), flags: {is_active: true, is_valid: false}},
            {...connected("bad"), slug: null},
            {...connected("bad"), provider_key: null},
        ]) {
            expect(() => withOnboardingTools({}, [connection as ToolConnection], ["bad"])).toThrow(
                /reconnecting/,
            )
        }
    })
})
