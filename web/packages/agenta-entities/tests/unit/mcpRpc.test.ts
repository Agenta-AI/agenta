/**
 * Reading an MCP server's answer.
 *
 * Every case here is one where a lenient reader would hand the caller an empty tool list:
 * an event-stream body it could not decode, a JSON-RPC error it did not look for, a result
 * with no `tools` member. An empty catalogue and a failed conversation have to stay
 * distinguishable, because only the first is safe to present as a connected server.
 */
import {describe, expect, it} from "vitest"

import {
    jsonRpcErrorMessage,
    jsonRpcResult,
    McpProtocolError,
    readJsonRpcPayload,
    readToolPage,
} from "../../src/mcpEndpoint/core/mcpRpc"

describe("readJsonRpcPayload", () => {
    it("takes a decoded JSON body as it stands", () => {
        expect(readJsonRpcPayload({jsonrpc: "2.0", id: 1, result: {ok: true}})).toEqual({
            jsonrpc: "2.0",
            id: 1,
            result: {ok: true},
        })
    })

    it("reads the payload out of a single event-stream frame", () => {
        const body = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n'

        expect(readJsonRpcPayload(body)?.result).toEqual({ok: true})
    })

    it("takes the answering frame when notifications precede it", () => {
        const body = [
            'data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}',
            "",
            'data: {"jsonrpc":"2.0","id":2,"result":{"tools":[]}}',
            "",
        ].join("\n")

        expect(readJsonRpcPayload(body)?.result).toEqual({tools: []})
    })

    it("joins the data lines of one frame, which the transport splits on newlines", () => {
        const body = 'data: {"jsonrpc":"2.0","id":1,\ndata: "result":{"ok":true}}\n\n'

        expect(readJsonRpcPayload(body)?.result).toEqual({ok: true})
    })

    it("returns null for a body that is not JSON-RPC at all", () => {
        expect(readJsonRpcPayload("<html>proxy error</html>")).toBeNull()
        expect(readJsonRpcPayload("")).toBeNull()
        expect(readJsonRpcPayload(undefined)).toBeNull()
        expect(readJsonRpcPayload([1, 2])).toBeNull()
    })
})

describe("jsonRpcErrorMessage", () => {
    it("returns the sentence a JSON-RPC error carries", () => {
        expect(
            jsonRpcErrorMessage({
                jsonrpc: "2.0",
                id: null,
                error: {code: -32000, message: "The MCP gateway is disabled on this deployment."},
            }),
        ).toBe("The MCP gateway is disabled on this deployment.")
    })

    it("returns null when there is no error to report", () => {
        expect(jsonRpcErrorMessage({jsonrpc: "2.0", id: 1, result: {}})).toBeNull()
        expect(jsonRpcErrorMessage({error: {code: -1, message: "   "}})).toBeNull()
        expect(jsonRpcErrorMessage("not json")).toBeNull()
    })
})

describe("jsonRpcResult", () => {
    it("returns the result of a call that succeeded", () => {
        expect(jsonRpcResult({jsonrpc: "2.0", id: 1, result: {tools: []}}, "tools/list")).toEqual({
            tools: [],
        })
    })

    it("raises the server's wording for a call it refused", () => {
        expect(() =>
            jsonRpcResult(
                {jsonrpc: "2.0", id: 1, error: {code: -32601, message: "Method not found"}},
                "tools/list",
            ),
        ).toThrow(new McpProtocolError("Method not found"))
    })

    it("names the failed call when the answer is unreadable", () => {
        expect(() => jsonRpcResult("<html>502</html>", "initialize")).toThrow(/initialize/)
        expect(() => jsonRpcResult({jsonrpc: "2.0", id: 1}, "initialize")).toThrow(
            /carried no result/,
        )
    })
})

describe("readToolPage", () => {
    it("keeps the named tools and the cursor for the next page", () => {
        expect(
            readToolPage({
                tools: [
                    {name: "echo", description: "Echo it back"},
                    {name: "wipe"},
                    {description: "nameless"},
                    "not a tool",
                ],
                nextCursor: "page-2",
            }),
        ).toEqual({
            tools: [{name: "echo", description: "Echo it back"}, {name: "wipe"}],
            nextCursor: "page-2",
        })
    })

    it("reports a last page as a last page", () => {
        expect(readToolPage({tools: []})).toEqual({tools: [], nextCursor: null})
        expect(readToolPage({tools: [], nextCursor: ""}).nextCursor).toBeNull()
    })

    it("raises rather than read a missing tools member as an empty server", () => {
        expect(() => readToolPage({})).toThrow(McpProtocolError)
        expect(() => readToolPage({tools: "echo"})).toThrow(/tool list was missing/)
    })
})
