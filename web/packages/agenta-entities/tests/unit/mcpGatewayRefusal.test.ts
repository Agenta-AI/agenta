import {describe, expect, it} from "vitest"

import {gatewayRefusalMessage, isNameTakenRefusal} from "../../src/mcpEndpoint/core/refusal"

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
