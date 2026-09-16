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
import type {MCPProbeProblem} from "./types"

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
