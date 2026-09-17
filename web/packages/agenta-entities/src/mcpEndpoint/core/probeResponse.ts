/**
 * What a failed probe let the person see of the server's own answer.
 *
 * The connect sheet offers "Show response" so someone pointing at the wrong address can read what
 * actually came back rather than only the sentence written about it. That control appears only when
 * there is a response to show, which is what this reader decides.
 *
 * Always null today. `MCPServerProbe` carries a closed set of causes and one English sentence, and
 * the probe never puts the body or the status line in either: the status code reaches the message
 * only in the not-an-MCP-server case, interpolated into prose. Parsing it back out of that sentence
 * would be reading copy as data, which is the thing this package refuses to do everywhere else.
 *
 * The seam rather than the fix: the day the probe returns the status line and a truncated body, this
 * function reads them and the control appears with no other change. Tracked as the API gap filed for
 * decision 31.
 */
import type {MCPProbeProblem, MCPServerProbe} from "./types"

/** The longest body a panel shows. Beyond this a person is reading a page, not a diagnosis. */
export const PROBE_RESPONSE_BODY_LIMIT = 300

export interface McpProbeResponse {
    /** The response's status line, e.g. `404 Not Found`. */
    status: string
    /** The body, truncated to `PROBE_RESPONSE_BODY_LIMIT` characters. */
    body: string
}

export function readMcpProbeResponse(
    problem: MCPProbeProblem | null | undefined,
): McpProbeResponse | null {
    const carried = (problem as {response?: unknown} | null | undefined)?.response
    if (!carried || typeof carried !== "object") return null
    const {status, body} = carried as {status?: unknown; body?: unknown}
    if (typeof status !== "string" || !status.trim()) return null
    return {
        status: status.trim(),
        body: typeof body === "string" ? body.slice(0, PROBE_RESPONSE_BODY_LIMIT) : "",
    }
}

/**
 * The scheme a server named when it refused the anonymous handshake, or null.
 *
 * The key screen used to prefill `Authorization` and say nothing about why, because the
 * probe discarded the challenge it read (WP2's third unmet criterion). It carries it now.
 *
 * The first scheme only. RFC 9110 s11.6.1 lets a server send several and orders them by its
 * own preference, so the first is the one it would rather have. The rest are visible in the
 * probe for anything that wants them.
 */
export function mcpChallengeScheme(probe: MCPServerProbe | null | undefined): string | null {
    const named = probe?.auth?.challenge_schemes?.find((scheme) => !!scheme?.trim())
    return named ? named.trim() : null
}

/**
 * The scheme token HTTP already carries in `Authorization`.
 *
 * A scheme is not a header name: `Bearer` means `Authorization: Bearer <token>`, which is
 * what this product sends when an endpoint registers no header of its own. So a Bearer
 * challenge is the default already answered, and there is nothing to tell anyone. Any other
 * scheme is worth naming, because the reader is the only one who can say which header this
 * particular server wants it in.
 */
export const MCP_DEFAULT_CHALLENGE_SCHEME = "Bearer"

/** The scheme worth telling the reader about, which is any the default does not cover. */
export function mcpChallengeSchemeToShow(probe: MCPServerProbe | null | undefined): string | null {
    const scheme = mcpChallengeScheme(probe)
    if (!scheme) return null
    return scheme.toLowerCase() === MCP_DEFAULT_CHALLENGE_SCHEME.toLowerCase() ? null : scheme
}

/**
 * The status this server refuses an unacceptable credential with, or null.
 *
 * The challenge the probe read is the evidence: it is how the server answered a request it
 * would not authorize, which is exactly what a rejected key is. The number the spec's C6
 * sentence names comes from here rather than from the failure itself, because the failure
 * reaches this client through the relay and carries the relay's status, not the server's.
 *
 * Null where nothing challenged, and a reconnect never probes, so that sentence drops the
 * clause rather than guessing a number.
 */
export function mcpChallengeStatus(probe: MCPServerProbe | null | undefined): number | null {
    const status = probe?.auth?.challenge_status
    return typeof status === "number" && status > 0 ? status : null
}

/**
 * The header name the key screen starts with, from what the server's challenge named.
 *
 * The spec's C5 note: the header is prefilled from the probe, "using the WWW-Authenticate
 * scheme to pick Authorization and otherwise x-api-key". A scheme travels in `Authorization`
 * by definition, so a server that named one has told us the header. A server that challenged
 * and named nothing has told us only that it wants a credential, and the commonest header for
 * one that is not a scheme is `x-api-key`, which is also the placeholder this field has always
 * shown. Either way it stays editable, and either way the value is a starting point rather
 * than a claim.
 *
 * A journey with no probe keeps `Authorization`: a reconnect never probes, and changing the
 * header under a connection that already works would be a guess about somebody's server.
 */
export function mcpDefaultKeyHeader(probe: MCPServerProbe | null | undefined): string {
    if (!probe) return "Authorization"
    return mcpChallengeScheme(probe) ? "Authorization" : "x-api-key"
}
