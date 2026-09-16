/**
 * The runner's "this MCP server did not join the run" notice, as the chat reads it.
 *
 * UI QA round 3, D2: after a connection is disconnected, the turn showed the harness's own
 * `<tool_use_error>Error: No such tool available: mcp__mock-mcp__echo</tool_use_error>` and nothing
 * about authorization, while the configuration rail on the same page read "Needs authorization ·
 * Connect". The notice carrying the remedy was already on the wire and nothing read it.
 *
 * The payloads below are the shapes recorded in docs/design/gateways-research/v1/qa.md (OR85) and
 * in the SDK's own projection test, marker and all.
 */
import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {unwrapToolUseError} from "../../../src/assets/toolFormat"
import {
    endpointIdFromConnectPath,
    isExplainedByMcpNotice,
    mcpServerNotices,
    mcpServerNoticeSentence,
    mcpToolServerName,
    readMcpServerNotice,
    slugFromMcpTarget,
} from "../../../src/model/mcpServerNotice"
import {buildTurnRenderItems} from "../../../src/model/renderModel"

const AUTH_NOTICE = {
    serverName: "mock-mcp",
    reasonCode: "handshake_http_error",
    status: 409,
    message: "MCP server mock-mcp failed to connect: 409",
    detail: {
        code: "auth_required",
        message:
            "Authorization required for custom/or85-oauth-8c3491eb ⟦agenta_code:auth_required⟧",
        retryable: false,
        details: {
            cause: "auth_required",
            requirement: {
                target: "custom/or85-oauth-8c3491eb",
                state: "needs_auth",
                connect: {endpoint: "/gateways/mcps/endpoints/ep-42/connect", body: {}},
            },
        },
    },
}

/** A server that is simply down: no refusal body, so no remedy rides it. */
const UNREACHABLE_NOTICE = {
    serverName: "acme",
    reasonCode: "handshake_unreachable",
    message: "MCP server acme failed to connect: handshake_unreachable",
}

const noticePart = (data: unknown) =>
    ({type: "data-mcp-server-failed", data}) as unknown as UIMessage["parts"][number]

const toolPart = (name: string, state: string, errorText?: string) =>
    ({
        type: `tool-${name}`,
        toolCallId: `call-${name}`,
        state,
        input: {marker: "MCP-ACCEPTANCE-D"},
        ...(errorText ? {errorText} : {}),
    }) as unknown as UIMessage["parts"][number]

describe("readMcpServerNotice", () => {
    it("reads the reconnect requirement out of a disconnected connection's refusal", () => {
        const notice = readMcpServerNotice(AUTH_NOTICE)
        expect(notice).not.toBeNull()
        expect(notice?.serverName).toBe("mock-mcp")
        expect(notice?.code).toBe("auth_required")
        expect(notice?.needsAuthorization).toBe(true)
        expect(notice?.target).toBe("custom/or85-oauth-8c3491eb")
        expect(notice?.slug).toBe("or85-oauth-8c3491eb")
        expect(notice?.endpointId).toBe("ep-42")
    })

    it("never carries the runner's machine-addressed marker into the stated message", () => {
        expect(readMcpServerNotice(AUTH_NOTICE)?.statedMessage).toBe(
            "Authorization required for custom/or85-oauth-8c3491eb",
        )
    })

    it("keeps a notice that carries no remedy, and offers none", () => {
        const notice = readMcpServerNotice(UNREACHABLE_NOTICE)
        expect(notice?.needsAuthorization).toBe(false)
        expect(notice?.slug).toBeNull()
        expect(notice?.endpointId).toBeNull()
        expect(notice?.statedMessage).toBe(
            "MCP server acme failed to connect: handshake_unreachable",
        )
    })

    it("is not fooled by a payload that is not a notice", () => {
        for (const data of [null, undefined, "boom", {}, {serverName: "   "}, []]) {
            expect(readMcpServerNotice(data)).toBeNull()
        }
    })

    it("reads the path and target helpers on their own", () => {
        expect(slugFromMcpTarget("custom/acme")).toBe("acme")
        expect(slugFromMcpTarget("acme")).toBe("acme")
        expect(slugFromMcpTarget(null)).toBeNull()
        expect(endpointIdFromConnectPath("/gateways/mcps/endpoints/abc-1/connect")).toBe("abc-1")
        expect(endpointIdFromConnectPath("/gateways/mcps/endpoints/connect")).toBeNull()
        expect(endpointIdFromConnectPath(null)).toBeNull()
    })
})

describe("mcpServerNoticeSentence", () => {
    it("says what is wrong and names the connection", () => {
        const notice = readMcpServerNotice(AUTH_NOTICE)!
        expect(mcpServerNoticeSentence(notice)).toBe(
            "mock-mcp needs authorization before its tools can run",
        )
    })

    it("prefers the connection's own display name once the row is resolved", () => {
        const notice = readMcpServerNotice(AUTH_NOTICE)!
        expect(mcpServerNoticeSentence(notice, "Acme Notion")).toBe(
            "Acme Notion needs authorization before its tools can run",
        )
        // An absent or blank name falls back rather than rendering an empty subject.
        expect(mcpServerNoticeSentence(notice, "  ")).toBe(
            "mock-mcp needs authorization before its tools can run",
        )
    })

    it("keeps the run's own sentence for a failure it has not classified", () => {
        const notice = readMcpServerNotice(UNREACHABLE_NOTICE)!
        expect(mcpServerNoticeSentence(notice)).toBe(
            "MCP server acme failed to connect: handshake_unreachable",
        )
    })
})

describe("mcpToolServerName", () => {
    it("reads the server out of every spelling a harness uses", () => {
        expect(mcpToolServerName("mcp__mock-mcp__echo")).toBe("mock-mcp")
        expect(mcpToolServerName("mcp.mock-mcp.echo")).toBe("mock-mcp")
    })

    it("returns nothing for a name that is not an MCP tool", () => {
        for (const name of ["echo", "tools__composio__gmail__SEND", "mcp__echo", "mcp."]) {
            expect(mcpToolServerName(name)).toBeNull()
        }
    })
})

describe("the turn's render items", () => {
    const options = {executed: new Set<string>(), isClientToolPart: () => false}

    it("renders the notice and drops the failure it already explains", () => {
        const items = buildTurnRenderItems(
            [
                noticePart(AUTH_NOTICE),
                toolPart(
                    "mcp__mock-mcp__echo",
                    "output-error",
                    "<tool_use_error>Error: No such tool available: mcp__mock-mcp__echo</tool_use_error>",
                ),
            ],
            options,
        )
        expect(items.map((item) => item.kind)).toEqual(["mcpNotice"])
        expect(items[0].kind === "mcpNotice" && items[0].notice.serverName).toBe("mock-mcp")
    })

    it("drops the failure even when the notice arrives after it", () => {
        const items = buildTurnRenderItems(
            [toolPart("mcp__mock-mcp__echo", "output-error", "boom"), noticePart(AUTH_NOTICE)],
            options,
        )
        expect(items.map((item) => item.kind)).toEqual(["mcpNotice"])
    })

    it("keeps a failure from a server the notice does not name", () => {
        const items = buildTurnRenderItems(
            [noticePart(AUTH_NOTICE), toolPart("mcp__other__echo", "output-error", "boom")],
            options,
        )
        expect(items.map((item) => item.kind)).toEqual(["mcpNotice", "tools"])
    })

    it("keeps a SUCCESSFUL call to the named server: it ran, so the turn must show it", () => {
        const items = buildTurnRenderItems(
            [noticePart(AUTH_NOTICE), toolPart("mcp__mock-mcp__echo", "output-available")],
            options,
        )
        expect(items.map((item) => item.kind)).toEqual(["mcpNotice", "tools"])
    })

    it("explains nothing when the notice carries no authorization requirement", () => {
        expect(
            isExplainedByMcpNotice("mcp__acme__ping", [readMcpServerNotice(UNREACHABLE_NOTICE)!]),
        ).toBe(false)
    })

    it("finds every notice a turn carries", () => {
        const notices = mcpServerNotices([
            noticePart(AUTH_NOTICE),
            noticePart(UNREACHABLE_NOTICE),
            noticePart("not a notice"),
        ])
        expect(notices.map((n) => n.serverName)).toEqual(["mock-mcp", "acme"])
    })
})

describe("unwrapToolUseError", () => {
    it("removes the wrapper a harness addresses to its own model", () => {
        expect(
            unwrapToolUseError(
                "<tool_use_error>Error: No such tool available: mcp__mock-mcp__echo</tool_use_error>",
            ),
        ).toBe("Error: No such tool available: mcp__mock-mcp__echo")
    })

    it("removes it through the code fence the backend wraps errors in", () => {
        expect(
            unwrapToolUseError(
                "```\n<tool_use_error>InputValidationError: bad JSON.</tool_use_error>\n```",
            ),
        ).toBe("InputValidationError: bad JSON.")
    })

    it("leaves an error that merely mentions the tag alone", () => {
        const quoted = "the model wrote <tool_use_error> in its answer"
        expect(unwrapToolUseError(quoted)).toBe(quoted)
        expect(unwrapToolUseError("plain failure")).toBe("plain failure")
    })
})
