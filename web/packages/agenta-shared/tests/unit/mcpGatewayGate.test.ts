import {afterEach, describe, expect, it} from "vitest"

import {isMcpGatewayEnabled, isSandboxLocalEnabled} from "../../src/api/env"

const KEY = "NEXT_PUBLIC_AGENTA_MCP_GATEWAY_ENABLED"
const SANDBOX_KEY = "NEXT_PUBLIC_AGENTA_SANDBOX_LOCAL_ENABLED"

/**
 * `getEnv` reads `globalThis.__env` first, which is what `entrypoint.sh` writes into
 * `__env.js` at container start. Setting it here is the same seam the browser sees.
 */
const runtimeEnv = (value?: string, key: string = KEY) => {
    if (value === undefined) {
        delete (globalThis as Record<string, any>).__env
        return
    }
    ;(globalThis as Record<string, any>).__env = {[key]: value}
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

    it("is off for the literal false, in any casing or padding", () => {
        runtimeEnv("false")
        expect(isMcpGatewayEnabled()).toBe(false)
        runtimeEnv("FALSE")
        expect(isMcpGatewayEnabled()).toBe(false)
        runtimeEnv(" false ")
        expect(isMcpGatewayEnabled()).toBe(false)
    })

    it("is off for every spelling the API also reads as off", () => {
        // The operator writes one switch in one env file. `0` stopping the API while the
        // interface keeps offering MCP settings, a connect journey and an agent-config
        // surface — all of them answered with a 403 — is the failure this covers.
        for (const off of ["0", "off", "no", "n", "disabled", "nope"]) {
            runtimeEnv(off)
            expect(isMcpGatewayEnabled()).toBe(false)
        }
    })

    it("is on for every spelling the API reads as on", () => {
        for (const on of ["true", "1", "t", "y", "yes", "on", "enable", "enabled", "YES"]) {
            runtimeEnv(on)
            expect(isMcpGatewayEnabled()).toBe(true)
        }
    })
})

describe("isSandboxLocalEnabled", () => {
    it("reads the same vocabulary, from the same parser", () => {
        runtimeEnv(undefined)
        expect(isSandboxLocalEnabled()).toBe(true)
        runtimeEnv("   ", SANDBOX_KEY)
        expect(isSandboxLocalEnabled()).toBe(true)
        runtimeEnv("enabled", SANDBOX_KEY)
        expect(isSandboxLocalEnabled()).toBe(true)
        runtimeEnv("0", SANDBOX_KEY)
        expect(isSandboxLocalEnabled()).toBe(false)
    })
})
