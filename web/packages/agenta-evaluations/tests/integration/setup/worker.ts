/**
 * Vitest worker setup for integration tests.
 *
 * The eval controller talks to the backend exclusively through the Fern
 * @agentaai/api-client (via @agenta/sdk). getAgentaSdkClient() reads AGENTA_API_KEY /
 * AGENTA_HOST from env on first (lazy) construction, so set them here — before any test
 * file invokes the controller — so the singleton authenticates against the ephemeral
 * account provisioned in global.ts.
 */

const apiKey = process.env.AGENTA_TEST_API_KEY
if (apiKey) {
    process.env.AGENTA_API_KEY = apiKey
    if (process.env.AGENTA_API_URL) {
        process.env.AGENTA_HOST = process.env.AGENTA_API_URL
    }
}
