/**
 * Worker setup — bridge the ephemeral API key to the Fern client.
 *
 * The shared @agenta/entities global setup provisions an ephemeral account and exposes its key
 * as `AGENTA_TEST_API_KEY`, then configures axios auth (worker.ts). But Fern-backed entity
 * queries (e.g. the testsets-list query behind testsetsListAtom) authenticate via the Fern
 * client `getAgentaSdkClient`, which reads `AGENTA_API_KEY` — not the axios header. Without this
 * bridge those queries 401. Must run before any getAgentaSdkClient() call (the client is a lazy
 * singleton), which setupFiles guarantee.
 */
if (process.env.AGENTA_TEST_API_KEY && !process.env.AGENTA_API_KEY) {
    process.env.AGENTA_API_KEY = process.env.AGENTA_TEST_API_KEY
}
