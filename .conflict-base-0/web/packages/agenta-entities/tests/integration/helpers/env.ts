/**
 * Integration test environment configuration.
 *
 * AGENTA_TEST_API_KEY and AGENTA_TEST_PROJECT_ID are NOT set manually —
 * they are provisioned dynamically by the global setup (see setup/global.ts)
 * from an ephemeral account created via the admin endpoint.
 *
 * The only vars the runner must provide are AGENTA_API_URL and AGENTA_AUTH_KEY
 * (e.g. via run-tests.ts --env-file, mirroring the Python run-tests.py runners).
 */

export const TEST_CONFIG = {
    apiUrl: process.env.AGENTA_API_URL || "",
    apiKey: process.env.AGENTA_TEST_API_KEY || "",
    projectId: process.env.AGENTA_TEST_PROJECT_ID || "",
}

/**
 * True when globalSetup successfully provisioned an ephemeral account.
 * Tests guarded by this will skip if AGENTA_API_URL / AGENTA_AUTH_KEY
 * were not set or account creation failed.
 */
export const hasBackend = Boolean(TEST_CONFIG.apiKey && TEST_CONFIG.projectId)
