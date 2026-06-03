/**
 * Global setup — runs once in the main process before any workers spawn.
 *
 * Creates a fresh ephemeral test account via the admin endpoint so tests
 * never rely on hardcoded credentials. Credentials are written to process.env
 * and inherited by worker threads when they start.
 *
 * Required env vars (load from deployment config, never hardcode):
 *   AGENTA_API_URL   — base URL of a running Agenta instance (e.g. http://localhost/api)
 *   AGENTA_AUTH_KEY  — admin access key (AGENTA_AUTH_KEY in the deployment .env)
 */

import {randomUUID} from "crypto"

interface EphemeralAccount {
    api_keys: {key: string}
    projects: {prj: {id: string}}
}

interface CreateAccountsResponse {
    accounts: Record<string, EphemeralAccount>
}

export async function setup() {
    const apiUrl = process.env.AGENTA_API_URL
    const authKey = process.env.AGENTA_AUTH_KEY

    if (!apiUrl || !authKey) {
        // Clear any credentials left over from a previous run, otherwise
        // helpers/env.ts would still report hasBackend=true and the suite would
        // hit a stale project/backend instead of skipping.
        delete process.env.AGENTA_TEST_API_KEY
        delete process.env.AGENTA_TEST_PROJECT_ID
        delete process.env.NEXT_PUBLIC_AGENTA_API_URL
        console.warn(
            "\n[integration] AGENTA_API_URL or AGENTA_AUTH_KEY not set." +
                "\n[integration] All integration tests will be skipped." +
                "\n[integration] Pass an env file to the runner, e.g.:" +
                "\n[integration]   AGENTA_API_URL=http://localhost/api \\" +
                "\n[integration]   AGENTA_AUTH_KEY=<admin key> \\" +
                "\n[integration]   pnpm run test:integration\n",
        )
        return
    }

    // Bridge for getAgentaApiUrl() — workers inherit this because they are
    // spawned after globalSetup completes.
    process.env.NEXT_PUBLIC_AGENTA_API_URL = apiUrl

    // Create a fresh ephemeral account scoped to this test run.
    const uniqueId = randomUUID().replace(/-/g, "").slice(0, 12)

    const response = await fetch(`${apiUrl}/admin/simple/accounts/`, {
        method: "POST",
        // Explicit timeout so a hung backend fails the run fast and
        // deterministically rather than waiting on Undici's ~300s default.
        signal: AbortSignal.timeout(30_000),
        headers: {
            "Content-Type": "application/json",
            Authorization: `Access ${authKey}`,
        },
        body: JSON.stringify({
            accounts: {
                user: {
                    user: {email: `${uniqueId}@test.agenta.ai`},
                    options: {
                        create_api_keys: true,
                        return_api_keys: true,
                        seed_defaults: false,
                    },
                },
            },
        }),
    })

    if (!response.ok) {
        throw new Error(
            `[integration] Failed to create ephemeral account: ${response.status} ${await response.text()}`,
        )
    }

    const json = (await response.json()) as CreateAccountsResponse
    const account = Object.values(json.accounts)[0]

    const apiKey = account?.api_keys?.key
    const projectId = account?.projects?.prj?.id

    if (!apiKey || !projectId) {
        throw new Error(
            "[integration] Ephemeral account response missing api_keys.key or projects.prj.id",
        )
    }

    // Expose credentials to workers via process.env. These are consumed by
    // tests/integration/setup/worker.ts (axios header) and helpers/env.ts.
    process.env.AGENTA_TEST_API_KEY = apiKey
    process.env.AGENTA_TEST_PROJECT_ID = projectId

    console.info(
        `\n[integration] Ephemeral account: ${uniqueId}@test.agenta.ai` +
            `\n[integration] Running against: ${apiUrl}` +
            `\n[integration] Project: ${projectId}\n`,
    )
}
