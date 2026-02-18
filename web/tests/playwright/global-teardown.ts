/**
 * This script cleans up after Playwright tests.
 */

import {readFileSync} from "fs"
import {dirname, resolve} from "path"
import {fileURLToPath} from "url"

import {StandardSecretDTO} from "../../oss/src/lib/Types"

const LOCALHOST_OR_IPV4_REGEX =
    /^(localhost|((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?))$/i

const getSupertokensAccessCookieName = (...urls: string[]): string => {
    for (const currentURL of urls) {
        if (!currentURL) continue

        try {
            const parsed = new URL(currentURL)
            if (
                parsed.port &&
                (LOCALHOST_OR_IPV4_REGEX.test(parsed.hostname) || parsed.hostname.includes(":"))
            ) {
                return `sAccessToken_${parsed.port}`
            }
        } catch {
            // Try next candidate URL.
        }
    }

    return "sAccessToken"
}

/**
 * Runs after tests complete.
 * Attempts to delete all accounts in local OSS testing environments.
 * Uses environment variables to determine eligibility and endpoint configuration.
 */
async function globalTeardown() {
    console.log("[global-teardown] Starting global teardown...")
    const baseURL = process.env.AGENTA_WEB_URL || "http://localhost"
    console.log(`[global-teardown] Using web-url: ${baseURL}`)

    const token = process.env.AGENTA_AUTH_KEY
    const apiURL = process.env.AGENTA_API_URL || `${baseURL}/api`
    console.log(`[global-teardown] Using api-url: ${apiURL}`)

    const license = process.env.AGENTA_LICENSE || "oss"
    console.log(
        `[global-teardown] Environment variables - token: ${token ? "present" : "absent"}, AGENTA_LICENSE: ${license}`,
    )
    if (token && license === "oss") {
        console.log(
            "[global-teardown] Conditions met for deleting all accounts, sending request...",
        )
        try {
            await fetch(`${apiURL}/admin/accounts/delete-all`, {
                method: "POST",
                headers: {
                    Authorization: `Access ${token}`,
                },
            })
            console.log("[global-teardown] Deleted all accounts successfully")
        } catch (error) {
            console.error("[global-teardown] Error deleting accounts:", error)
        }
    } else {
        console.log("[global-teardown] Cannot delete all accounts: conditions not met")
    }

    try {
        console.log("[global-teardown] Deleting model hub secrets...")
        const __filename = fileURLToPath(import.meta.url)
        const __dirname = dirname(__filename)

        const statePath = resolve(__dirname, "../state.json")
        const data = readFileSync(statePath, "utf8")
        const state = JSON.parse(data)
        const accessCookieName = getSupertokensAccessCookieName(apiURL, baseURL)
        const sessionToken =
            state.cookies?.find((c: any) => c.name === accessCookieName)?.value ??
            state.cookies?.find((c: any) => c.name === "sAccessToken")?.value
        console.log(
            `[teardown] Extracted session token from state.json: ${sessionToken ? "present" : "absent"}`,
        )

        const secretsResp = await fetch(`${apiURL}/vault/v1/secrets/`, {
            headers: {Authorization: `Bearer ${sessionToken}`},
        })

        if (!secretsResp.ok) {
            console.error("[global-teardown] Failed to fetch secrets", await secretsResp.text())
            return
        }

        const secrets = (await secretsResp.json()) as StandardSecretDTO[]

        const openaiSecrets = secrets.filter((s) =>
            s?.header?.name?.toLowerCase().includes("openai"),
        )

        for (const secret of openaiSecrets) {
            try {
                await fetch(`${apiURL}/vault/v1/secrets/${secret.id}`, {
                    method: "DELETE",
                    headers: {Authorization: `Bearer ${sessionToken}`},
                })
                console.log(`[global-teardown] Deleted model hub secret ${secret.id}`)
            } catch (err) {
                console.error(`[global-teardown] Failed to delete secret ${secret.id}`, err)
            }
        }
    } catch (err) {
        console.error("[global-teardown] Error cleaning up model hub key", err)
    }
}

export default globalTeardown
