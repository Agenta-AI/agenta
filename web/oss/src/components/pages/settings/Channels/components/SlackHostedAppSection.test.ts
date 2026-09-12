import {describe, expect, it, vi} from "vitest"

vi.mock("@/oss/lib/helpers/api", () => ({
    getAgentaApiUrl: vi.fn(() => "https://api.example.test"),
}))

import {buildSlackInstallUrl} from "./SlackHostedAppSection"

describe("buildSlackInstallUrl", () => {
    it("points at the literal install route, scoped to the project in view", () => {
        const url = buildSlackInstallUrl("project-123")

        expect(url).toBe(
            "https://api.example.test/channels/catalog/channels/slack/install/?project_id=project-123",
        )
    })

    it("url-encodes a project id that needs it", () => {
        const url = buildSlackInstallUrl("a b")

        expect(url).toContain("project_id=a+b")
    })
})
