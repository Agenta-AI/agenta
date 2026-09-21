/**
 * What a server asked for when it refused the anonymous handshake.
 *
 * The key screen asks a person for a header name, and the challenge is the only evidence
 * about it the probe ever saw. It used to be discarded, so the screen could offer nothing
 * but its placeholder. These decide what is worth showing, and the rule is not "show the
 * scheme": a Bearer challenge is the default this product already sends, so naming it would
 * tell a reader to do what is being done for them.
 */
import {describe, expect, it} from "vitest"

import {
    mcpChallengeScheme,
    mcpChallengeSchemeToShow,
    mcpChallengeStatus,
    mcpDefaultKeyHeader,
} from "../../src/mcpEndpoint/core/probeResponse"
import type {MCPServerProbe} from "../../src/mcpEndpoint/core/types"

const probe = (challenge_schemes?: string[], challenge_status?: number): MCPServerProbe => ({
    reachable: true,
    auth: {mode: "unknown", challenge_schemes, challenge_status},
})

describe("mcpChallengeScheme", () => {
    it("reads the scheme the server named", () => {
        expect(mcpChallengeScheme(probe(["Bearer"], 401))).toBe("Bearer")
    })

    it("prefers the first, which is the one the server would rather have", () => {
        // RFC 9110 s11.6.1 orders a multi-challenge header by the server's own preference.
        expect(mcpChallengeScheme(probe(["DSN", "Bearer"]))).toBe("DSN")
    })

    it("answers nothing when the challenge named nothing", () => {
        expect(mcpChallengeScheme(probe([]))).toBeNull()
        expect(mcpChallengeScheme(probe())).toBeNull()
        expect(mcpChallengeScheme(probe(["   "]))).toBeNull()
        expect(mcpChallengeScheme(null)).toBeNull()
    })
})

describe("mcpChallengeSchemeToShow", () => {
    it("says nothing about Bearer, which Authorization already carries", () => {
        // A scheme is not a header name: `Bearer` means `Authorization: Bearer <token>`,
        // which is exactly what an endpoint with no registered header sends.
        expect(mcpChallengeSchemeToShow(probe(["Bearer"]))).toBeNull()
        expect(mcpChallengeSchemeToShow(probe(["bearer"]))).toBeNull()
    })

    it("names any other scheme, because only the reader can place it", () => {
        expect(mcpChallengeSchemeToShow(probe(["DSN"]))).toBe("DSN")
    })

    it("names nothing when the server named nothing", () => {
        expect(mcpChallengeSchemeToShow(probe([]))).toBeNull()
    })
})

describe("mcpChallengeStatus", () => {
    it("reads the status the server refused with", () => {
        expect(mcpChallengeStatus(probe(["Bearer"], 401))).toBe(401)
    })

    it("answers nothing where nothing challenged", () => {
        // A reconnect never probes, and the spec's sentence drops its clause rather than
        // naming a number nobody was told.
        expect(mcpChallengeStatus(probe(["Bearer"]))).toBeNull()
        expect(mcpChallengeStatus(null)).toBeNull()
    })
})

describe("mcpDefaultKeyHeader", () => {
    it("picks Authorization when the challenge named a scheme", () => {
        // A scheme travels in `Authorization` by definition, so a server that named one has
        // told us the header.
        expect(mcpDefaultKeyHeader(probe(["Bearer"], 401))).toBe("Authorization")
        expect(mcpDefaultKeyHeader(probe(["DSN"], 401))).toBe("Authorization")
    })

    it("picks x-api-key when it challenged and named none", () => {
        // The spec's C5 note. A server that asked for a credential without naming a scheme
        // is asking for something that is not a scheme, and this is the commonest header for
        // one; it is also what this field has always shown as its placeholder.
        expect(mcpDefaultKeyHeader(probe([], 401))).toBe("x-api-key")
        expect(mcpDefaultKeyHeader(probe(undefined, 401))).toBe("x-api-key")
    })

    it("leaves Authorization alone where there was no probe at all", () => {
        // A reconnect never probes, and changing the header under a connection that already
        // works would be a guess about somebody's server.
        expect(mcpDefaultKeyHeader(null)).toBe("Authorization")
    })
})
