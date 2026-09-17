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
