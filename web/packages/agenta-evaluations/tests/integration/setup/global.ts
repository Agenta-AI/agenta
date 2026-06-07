/**
 * Global setup — runs once in the main process before any workers spawn.
 *
 * Creates a fresh ephemeral test account via the admin endpoint so tests never rely on
 * hardcoded credentials. Credentials are written to process.env and inherited by workers.
 * Mirrors the @agenta/entities / @agenta/annotation integration harness.
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
        delete process.env.AGENTA_TEST_API_KEY
        delete process.env.AGENTA_TEST_PROJECT_ID
        console.warn(
            "\n[integration] AGENTA_API_URL or AGENTA_AUTH_KEY not set." +
                "\n[integration] All integration tests will be skipped." +
                "\n[integration] Pass an env file to the runner, e.g.:" +
                "\n[integration]   AGENTA_API_URL=http://localhost/api \\" +
                "\n[integration]   AGENTA_AUTH_KEY=<admin key> \\" +
                "\n[integration]   pnpm --filter @agenta/evaluations run test:integration\n",
        )
        return
    }

    const uniqueId = randomUUID().replace(/-/g, "").slice(0, 12)

    const response = await fetch(`${apiUrl}/admin/simple/accounts/`, {
        method: "POST",
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

    process.env.AGENTA_TEST_API_KEY = apiKey
    process.env.AGENTA_TEST_PROJECT_ID = projectId

    console.info(
        `\n[integration] Ephemeral account: ${uniqueId}@test.agenta.ai` +
            `\n[integration] Running against: ${apiUrl}` +
            `\n[integration] Project: ${projectId}\n`,
    )
}
