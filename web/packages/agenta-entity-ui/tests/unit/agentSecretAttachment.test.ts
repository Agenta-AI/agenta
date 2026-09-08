import {describe, expect, it} from "vitest"

import {
    preserveAgentSecretEnvOverride,
    suggestedAgentSecretEnv,
} from "../../src/secret/AgentSecretAttachmentDrawer"

describe("agent secret environment suggestions", () => {
    it("prefers the request, then secret metadata, then a derived name", () => {
        expect(
            suggestedAgentSecretEnv({
                requestEnv: "REQUEST_TOKEN",
                defaultEnvVar: "DEFAULT_TOKEN",
                name: "GitHub token",
            }),
        ).toBe("REQUEST_TOKEN")
        expect(
            suggestedAgentSecretEnv({defaultEnvVar: "DEFAULT_TOKEN", name: "GitHub token"}),
        ).toBe("DEFAULT_TOKEN")
        expect(suggestedAgentSecretEnv({name: "GitHub token"})).toBe("GITHUB_TOKEN")
    })

    it("preserves a user override when the selected secret changes", () => {
        expect(
            preserveAgentSecretEnvOverride({
                current: "MY_GH_TOKEN",
                touched: true,
                requestEnv: "REQUEST_TOKEN",
                defaultEnvVar: "DEFAULT_TOKEN",
                name: "GitHub token",
            }),
        ).toBe("MY_GH_TOKEN")
    })
})
