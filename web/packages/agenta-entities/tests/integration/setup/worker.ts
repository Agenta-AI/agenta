/**
 * Vitest worker setup for integration tests.
 *
 * Runs once per worker before any test file is loaded. Sets the axios
 * Authorization header so fixture creation calls (beforeEach) are
 * authenticated even before createIntegrationStore() is called.
 */

import {axios} from "@agenta/shared/api"

const apiKey = process.env.AGENTA_TEST_API_KEY
if (apiKey) {
    axios.defaults.headers.common["Authorization"] = `ApiKey ${apiKey}`

    // Fern-client auth: entities migrating to @agentaai/api-client (via @agenta/sdk)
    // do NOT go through axios. getAgentaSdkClient() reads AGENTA_API_KEY / AGENTA_HOST
    // from env on first (lazy) construction, so set them here — before any test file
    // calls a Fern-backed api function — so the singleton authenticates correctly.
    process.env.AGENTA_API_KEY = apiKey
    if (process.env.AGENTA_API_URL) {
        process.env.AGENTA_HOST = process.env.AGENTA_API_URL
    }
}
