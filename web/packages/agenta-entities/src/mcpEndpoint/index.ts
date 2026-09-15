/**
 * MCP endpoint entity module.
 *
 * The gateway's `/gateways/mcps/endpoints` rows: their DTOs, the API calls, the derived
 * connection state, and the OAuth callback's postMessage contract.
 *
 * This lives in a package rather than in `web/oss` because two features now drive the same
 * flow: the Settings MCP dashboard and the agent config form in the playground (which registers
 * a server and then has to offer authorization inline).
 */
export * from "./api"
export * from "./core"
export * from "./state"
