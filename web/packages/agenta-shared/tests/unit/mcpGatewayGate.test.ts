import {afterEach, describe, expect, it} from "vitest"

import {isMcpGatewayEnabled} from "../../src/api/env"

const KEY = "NEXT_PUBLIC_AGENTA_MCP_GATEWAY_ENABLED"

/**
 * `getEnv` reads `globalThis.__env` first, which is what `entrypoint.sh` writes into
 * `__env.js` at container start. Setting it here is the same seam the browser sees.
 */
const runtimeEnv = (value?: string) => {
    if (value === undefined) {
        delete (globalThis as Record<string, any>).__env
        return
    }
    ;(globalThis as Record<string, any>).__env = {[KEY]: value}
}

afterEach(() => runtimeEnv(undefined))

describe("isMcpGatewayEnabled", () => {
    it("is on for a deployment that sets nothing", () => {
        // Every deployment that exists today sets nothing and shows the MCP endpoints tab.
        // This is the assertion that an upgrade does not take it away from them.
        runtimeEnv(undefined)
        expect(isMcpGatewayEnabled()).toBe(true)
    })

    it("is on when the variable is present but empty", () => {
        // Compose writes an unset variable through as "", which must not read as off.
        runtimeEnv("")
        expect(isMcpGatewayEnabled()).toBe(true)
    })

    it("is off only for the literal false", () => {
        runtimeEnv("false")
        expect(isMcpGatewayEnabled()).toBe(false)
        runtimeEnv("FALSE")
        expect(isMcpGatewayEnabled()).toBe(false)
        runtimeEnv(" false ")
        expect(isMcpGatewayEnabled()).toBe(false)
    })

    it("is on for true", () => {
        runtimeEnv("true")
        expect(isMcpGatewayEnabled()).toBe(true)
    })
})
