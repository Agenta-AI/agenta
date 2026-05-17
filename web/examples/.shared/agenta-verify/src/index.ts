/**
 * @agenta/spike-verify — verification harness for ts-sdk-tracing spike apps.
 *
 * Used by every spike app's canonical assertions to confirm that traces
 * actually arrive in Agenta with the expected shape. Throws typed errors
 * with full diagnostic context so a failing assertion is its own bug report.
 *
 * Retired when ts-sdk-tracing ships.
 */

export {verifyTrace, type VerifyOptions, type AttributeMatcher} from "./verify.js"

export {
    VerifyTimeoutError,
    VerifyMismatchError,
    VerifyAgentaUnreachableError,
    type AttributeMismatch,
    type PollAttempt,
} from "./errors.js"

export {
    createAgentaApiClient,
    type AgentaApiClient,
    type AgentaApiOptions,
    type AgentaSpan,
} from "./api.js"
