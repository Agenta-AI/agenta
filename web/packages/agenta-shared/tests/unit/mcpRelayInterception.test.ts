/**
 * Which URL the session layer must keep its hands off.
 *
 * Everything under the API domain answers 401 when OUR session has expired, and the session
 * library refreshes and retries on that. One route does not: the MCP relay passes a call to a
 * server the person chose, and that server's 401 means the credential THEY supplied was
 * refused. The library refreshed and retried a rejected API key ten times and handed the
 * journey a failure with no status on it, so the screen that exists to say "the server
 * rejected this key (401)" could never be reached (round 6d, D175).
 *
 * The exclusion has to be exactly this route. Excluding more would leave real session
 * expiries unrefreshed on those routes, which is the failure nobody would attribute to here.
 */
import {describe, expect, it} from "vitest"

import {isMcpRelayUrl} from "../../src/api/axios"

describe("the MCP relay route", () => {
    it("is recognised however the caller spells the address", () => {
        expect(isMcpRelayUrl("https://app.example.test/api/gateways/mcps/custom/linear")).toBe(true)
        expect(isMcpRelayUrl("/api/gateways/mcps/custom/linear")).toBe(true)
        expect(
            isMcpRelayUrl("https://app.example.test/api/gateways/mcps/custom/linear?project_id=1"),
        ).toBe(true)
    })

    it("leaves every other route to the session layer", () => {
        // A 401 from these IS our session expiring, and refusing the refresh here would sign
        // people out mid-session rather than renewing them.
        for (const url of [
            "https://app.example.test/api/gateways/mcps/endpoints/",
            "https://app.example.test/api/gateways/mcps/endpoints/abc/connect",
            "https://app.example.test/api/gateways/credentials",
            "https://app.example.test/api/workflows/revisions/query",
            "https://app.example.test/api/auth/session/refresh",
            "",
        ]) {
            expect({[url]: isMcpRelayUrl(url)}).toEqual({[url]: false})
        }
    })
})
