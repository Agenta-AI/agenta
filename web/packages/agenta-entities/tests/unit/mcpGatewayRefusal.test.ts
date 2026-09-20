import {describe, expect, it} from "vitest"

import {McpProtocolError} from "../../src/mcpEndpoint/core/mcpRpc"
import {
    gatewayRefusalCode,
    gatewayRefusalMessage,
    isNameTakenRefusal,
    credentialRefusalStatus,
    isCredentialRefusal,
} from "../../src/mcpEndpoint/core/refusal"

describe("gatewayRefusalMessage", () => {
    it("returns the plain detail a refusal carries, not the transport's status line", () => {
        const error = Object.assign(new Error("Request failed with status code 424"), {
            response: {
                data: {
                    detail: "OAuth discovery failed for http://server.test/: no protected-resource metadata found",
                },
            },
        })

        expect(gatewayRefusalMessage(error)).toBe(
            "OAuth discovery failed for http://server.test/: no protected-resource metadata found",
        )
    })

    it("joins the typed envelope's reason to its next step, because the step is the actionable half", () => {
        const error = {
            response: {
                data: {
                    detail: {
                        code: "routing_field_not_allowed",
                        message: "Request field 'models' selects models.",
                        next_step: "Remove the routing field.",
                    },
                },
            },
        }

        expect(gatewayRefusalMessage(error)).toBe(
            "Request field 'models' selects models. Remove the routing field.",
        )
    })

    it("returns the reason alone when the envelope names no next step", () => {
        const error = {response: {data: {detail: {message: "Endpoint is inactive."}}}}

        expect(gatewayRefusalMessage(error)).toBe("Endpoint is inactive.")
    })

    it("reads the data plane's JSON-RPC refusal, which carries no `detail`", () => {
        const error = Object.assign(new Error("Request failed with status code 403"), {
            response: {
                data: {
                    jsonrpc: "2.0",
                    id: null,
                    error: {
                        code: -32000,
                        message: "The MCP gateway is disabled on this deployment.",
                        data: {cause: "mcp_gateway_disabled"},
                    },
                },
            },
        })

        expect(gatewayRefusalMessage(error)).toBe("The MCP gateway is disabled on this deployment.")
    })

    it("keeps the wording of a failure this package's own MCP client already read", () => {
        expect(
            gatewayRefusalMessage(new McpProtocolError("This connection needs authorization.")),
        ).toBe("This connection needs authorization.")
    })

    it("returns null when the server wrote nothing, so the caller keeps its own wording", () => {
        expect(gatewayRefusalMessage(new Error("Network Error"))).toBeNull()
        expect(gatewayRefusalMessage({response: {data: {}}})).toBeNull()
        expect(gatewayRefusalMessage({response: {data: {detail: "   "}}})).toBeNull()
        expect(gatewayRefusalMessage(undefined)).toBeNull()
    })
})

describe("isNameTakenRefusal", () => {
    const refusal = (detail: unknown) => ({response: {data: {detail}}})

    it("recognizes the duplicate-name conflict by its code", () => {
        expect(
            isNameTakenRefusal(
                refusal({
                    code: "mcp_connection_name_taken",
                    message: "Another connection in this project already uses this name.",
                    next_step: "Give this connection a name no other one in the project uses.",
                }),
            ),
        ).toBe(true)
    })

    it("does not mistake another refusal for it", () => {
        expect(isNameTakenRefusal(refusal({code: "secret_missing", message: "x"}))).toBe(false)
        expect(isNameTakenRefusal(refusal("endpoint is not a custom OAuth target"))).toBe(false)
        expect(isNameTakenRefusal(new Error("Request failed with status code 409"))).toBe(false)
        expect(isNameTakenRefusal(null)).toBe(false)
    })
})

describe("the harness code marker", () => {
    const refusal = (detail: unknown) => ({response: {data: {detail}}})

    it("never reaches the sentence a person reads", () => {
        // Addressed to the runner, not to anyone looking at a screen (QA-D3).
        expect(
            gatewayRefusalMessage(
                refusal("Authorization required for custom/acme ⟦agenta_code:auth_required⟧"),
            ),
        ).toBe("Authorization required for custom/acme")
    })

    it("is still readable as a code, so a caller can act on it", () => {
        expect(
            gatewayRefusalCode(
                refusal("Authorization required for custom/acme ⟦agenta_code:auth_required⟧"),
            ),
        ).toBe("auth_required")
    })

    it("prefers the envelope's own code when there is one", () => {
        expect(gatewayRefusalCode(refusal({code: "mcp_connection_name_taken", message: "x"}))).toBe(
            "mcp_connection_name_taken",
        )
    })

    it("strips it out of an envelope message too", () => {
        expect(
            gatewayRefusalMessage(
                refusal({message: "Authorization required ⟦agenta_code:auth_required⟧"}),
            ),
        ).toBe("Authorization required")
    })

    it("says nothing when there is no code to read", () => {
        expect(gatewayRefusalCode(refusal("plain refusal"))).toBeNull()
        expect(gatewayRefusalCode(new Error("network"))).toBeNull()
    })

    it("reads the data plane's cause from the envelope, not out of the sentence", () => {
        // D50's third source, and the one the marker cannot stand in for. The relay refuses a
        // call in JSON-RPC: no `detail` at all, the cause stated structurally, and the message
        // written for a person with no marker in it. Every other case here carries the marker
        // too, so the last-resort scan answers them and this branch could be deleted unseen.
        const relayRefusal = {
            response: {
                data: {
                    jsonrpc: "2.0",
                    id: null,
                    error: {
                        code: -32000,
                        message: "This connection needs authorization.",
                        data: {cause: "auth_required", requirement: {state: "needs_auth"}},
                    },
                },
            },
        }

        expect(gatewayRefusalCode(relayRefusal)).toBe("auth_required")
        expect(gatewayRefusalMessage(relayRefusal)).toBe("This connection needs authorization.")
    })

    it("reads a hostile message in a moment, not in an afternoon", () => {
        // The body is written by whatever server the person pointed us at, so it is input from
        // outside. The pattern this parser used to hold began with `\s*` and then looked for a
        // marker: given a long run of whitespace and a marker that never closes, the engine
        // retried from every position in that run, and the cost grew with the square of the
        // length. Measured on this input, it took 2.9 seconds at fifty thousand and 45 seconds
        // at two hundred thousand, on a body a server chooses the length of (CodeQL
        // js/polynomial-redos). Reading each character once, it is immeasurable.
        const hostile = `${"\t".repeat(50_000)}⟦agenta_code:${"x".repeat(50_000)}`
        const started = Date.now()

        // No closing delimiter, so there is no code to read and nothing to strip.
        expect(gatewayRefusalCode(refusal(hostile))).toBeNull()
        expect(gatewayRefusalMessage(refusal(hostile))).toBe(hostile.trim())

        expect(Date.now() - started).toBeLessThan(500)
    })

    it("leaves one space behind when the marker sat mid-sentence", () => {
        expect(
            gatewayRefusalMessage(
                refusal("Authorization required ⟦agenta_code:auth_required⟧ for custom/acme"),
            ),
        ).toBe("Authorization required for custom/acme")
    })

    it("leaves a marker carrying no code alone rather than eating the sentence", () => {
        expect(gatewayRefusalMessage(refusal("Refused ⟦agenta_code:⟧"))).toBe(
            "Refused ⟦agenta_code:⟧",
        )
        expect(gatewayRefusalCode(refusal("Refused ⟦agenta_code:⟧"))).toBeNull()
    })
})

describe("which relay failures are the chosen server refusing a credential", () => {
    /** The OAuth form: the relay maps the refusal to 424 and names the cause. */
    const mapped = (status: number) => ({
        response: {
            status,
            data: {
                jsonrpc: "2.0",
                id: null,
                error: {
                    code: -32000,
                    message: "Upstream custom/axiom failed (401)",
                    data: {cause: "upstream_error", target: "custom/axiom"},
                },
            },
        },
    })

    /** The API-key form: the relay passes the server's status and body through bare. */
    const bare = (status: number, data: unknown) => ({response: {status, data}})

    it("recognises a bare relayed 401 as the server's answer, and names it", () => {
        // An API-key connection's refusal is not mapped: the relay passes the third party's
        // status and body through. Requiring the cause would stop a genuine wrong key being
        // recognised, which is D175 reintroduced through its own fix (round 4, D182).
        const refused = bare(401, {error: "invalid_api_key", detail: "bad key"})

        expect(isCredentialRefusal(refused)).toBe(true)
        expect(credentialRefusalStatus(refused)).toBe(401)
    })

    it("recognises the mapped form too, and names no code for it", () => {
        // 424 says the upstream refused and nothing about how, so printing it would put a
        // platform number where the sentence promises the server's.
        expect(isCredentialRefusal(mapped(424))).toBe(true)
        expect(credentialRefusalStatus(mapped(424))).toBeNull()
    })

    it("is not our own middleware's unauthorised answer", () => {
        // A session that expired between the internal read and the relay call answers with
        // one of two shapes we write. Neither is a verdict on anybody's credential.
        expect(isCredentialRefusal(bare(401, {detail: "Unauthorized"}))).toBe(false)
        expect(
            isCredentialRefusal(
                bare(401, {
                    detail: {message: "An unexpected error occurred.", operation_id: "op-1"},
                }),
            ),
        ).toBe(false)
    })

    it("is still the server's where its body merely carries a detail field", () => {
        // The relay forwards the third party's body verbatim and it may use that key, so
        // recognising ours by the presence of `detail` would swallow a real refusal.
        expect(isCredentialRefusal(bare(403, {detail: {message: "Forbidden for this key"}}))).toBe(
            true,
        )
    })

    it("is not a failure with no answer behind it", () => {
        expect(isCredentialRefusal(new Error("socket hang up"))).toBe(false)
        expect(isCredentialRefusal(bare(502, {}))).toBe(false)
    })
})
