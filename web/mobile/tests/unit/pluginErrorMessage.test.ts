import {describe, expect, it} from "vitest"
import {pluginErrorMessage} from "../../src/features/plugins/pluginErrorMessage"
describe("plugin errors", () => {
    it("explains a downstream refusal wrapped in a service failure", () => {
        expect(pluginErrorMessage({response: {status: 500, data: {status: {message: "MCP: HTTP 403 policy_denied"}}}})).toContain("Access denied")
    })
    it("explains direct viewer refusals", () => {
        expect(pluginErrorMessage({response: {status: 403}})).toContain("Access denied")
    })
    it("retains an operation error", () => {
        expect(pluginErrorMessage(new Error("Select at most five issues"))).toBe("Select at most five issues")
    })
})
