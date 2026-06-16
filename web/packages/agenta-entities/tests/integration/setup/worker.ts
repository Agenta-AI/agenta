/**
 * Vitest worker setup for integration tests.
 *
 * Runs once per worker before any test file is loaded. Authenticates both transports so
 * fixture creation (beforeEach) and queries work even before createIntegrationStore() is called.
 */

import {axios} from "@agenta/shared/api"

const apiKey = process.env.AGENTA_TEST_API_KEY
if (apiKey) {
    // Axios-based queries (e.g. single-entity fetches) read this default header.
    axios.defaults.headers.common["Authorization"] = `ApiKey ${apiKey}`

    // Fern-client-based queries (getAgentaSdkClient, e.g. the testsets-list query) authenticate
    // via the AGENTA_API_KEY env var, NOT the axios header. Bridge the ephemeral key so
    // Fern-backed entity queries don't 401 in integration tests. Runs before any
    // getAgentaSdkClient() call (the client is a lazy singleton), which setupFiles guarantee.
    if (!process.env.AGENTA_API_KEY) {
        process.env.AGENTA_API_KEY = apiKey
    }
}
