/**
 * Whether a failed probe has a response worth showing.
 *
 * The control it gates exists so a person who typed the wrong address can read what actually came
 * back. It must therefore appear only when there IS something to read: a "Show response" that opens
 * on an empty panel is worse than no control at all.
 */
import {describe, expect, it} from "vitest"

import {
    PROBE_RESPONSE_BODY_LIMIT,
    readMcpProbeResponse,
} from "../../src/mcpEndpoint/core/probeResponse"
import type {MCPProbeProblem} from "../../src/mcpEndpoint/core/types"

const problem = (extra: Record<string, unknown> = {}): MCPProbeProblem =>
    ({
        cause: "not_mcp",
        message: "The server answered 404 rather than the MCP handshake.",
        ...extra,
    }) as MCPProbeProblem

describe("readMcpProbeResponse", () => {
    it("has nothing to show for the refusals the probe returns today", () => {
        // The probe carries a cause and one English sentence. The status code reaches the message
        // only as prose, and reading it back out would be parsing copy as data.
        expect(readMcpProbeResponse(problem())).toBeNull()
        expect(readMcpProbeResponse(problem({transport: "unresolvable"}))).toBeNull()
        expect(readMcpProbeResponse(null)).toBeNull()
        expect(readMcpProbeResponse(undefined)).toBeNull()
    })

    it("reads the response the day the probe returns one", () => {
        expect(
            readMcpProbeResponse(problem({response: {status: "404 Not Found", body: "<html>"}})),
        ).toEqual({status: "404 Not Found", body: "<html>"})
    })

    it("truncates a body nobody is going to read in a panel", () => {
        const long = "x".repeat(PROBE_RESPONSE_BODY_LIMIT + 50)

        expect(readMcpProbeResponse(problem({response: {status: "500", body: long}}))?.body).toBe(
            "x".repeat(PROBE_RESPONSE_BODY_LIMIT),
        )
    })

    it("treats a response with no status line as no response", () => {
        expect(readMcpProbeResponse(problem({response: {body: "<html>"}}))).toBeNull()
        expect(readMcpProbeResponse(problem({response: {status: "   ", body: "x"}}))).toBeNull()
        expect(readMcpProbeResponse(problem({response: "404"}))).toBeNull()
    })

    it("shows a status line with an empty body rather than refusing it", () => {
        // An empty body IS the answer for a server that refused with nothing in it, and the status
        // line alone is what the person needs.
        expect(readMcpProbeResponse(problem({response: {status: "502 Bad Gateway"}}))).toEqual({
            status: "502 Bad Gateway",
            body: "",
        })
    })
})
