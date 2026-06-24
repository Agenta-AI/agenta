/**
 * Integration test environment configuration.
 *
 * AGENTA_TEST_API_KEY / AGENTA_TEST_PROJECT_ID are provisioned dynamically by global
 * setup (see setup/global.ts) from an ephemeral account. The only vars the runner must
 * provide are AGENTA_API_URL and AGENTA_AUTH_KEY.
 */
export const TEST_CONFIG = {
    apiUrl: process.env.AGENTA_API_URL || "",
    apiKey: process.env.AGENTA_TEST_API_KEY || "",
    projectId: process.env.AGENTA_TEST_PROJECT_ID || "",
}

/** True when globalSetup successfully provisioned an ephemeral account. */
export const hasBackend = Boolean(TEST_CONFIG.apiKey && TEST_CONFIG.projectId)
