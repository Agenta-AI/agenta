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
}
