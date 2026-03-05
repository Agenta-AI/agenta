/**
 * This script cleans up after Playwright tests.
 * Deletes the ephemeral project created during global-setup (if any),
 * then cleans up model hub secrets.
 */

import {StandardSecretDTO} from "../../oss/src/lib/Types"

import {existsSync, readFileSync, unlinkSync} from "fs"
import {dirname, resolve} from "path"
import {fileURLToPath} from "url"

/**
 * Extracts the session token from state.json for authenticated API calls.
 */
function getSessionToken(statePath: string): string | null {
    if (!existsSync(statePath)) {
        return null
    }
    const data = readFileSync(statePath, "utf8")
    const state = JSON.parse(data)
    return state.cookies?.find((c: any) => c.name === "sAccessToken")?.value ?? null
}

/**
 * Runs after tests complete.
 * 1. Deletes the ephemeral project created during setup (if any).
 * 2. Cleans up model hub secrets (OpenAI keys added during tests).
 * 3. Optionally deletes all accounts on disposable CI environments.
 */
async function globalTeardown() {
    console.log("[global-teardown] Starting global teardown...")
    const baseURL = process.env.AGENTA_WEB_URL || "http://localhost:3000"
    console.log(`[global-teardown] Using web-url: ${baseURL}`)

    const token = process.env.AGENTA_AUTH_KEY
    const apiURL = process.env.AGENTA_API_URL || `${baseURL}/api`
    const allowDestructiveTeardown =
        String(process.env.AGENTA_ALLOW_DESTRUCTIVE_TEARDOWN).toLowerCase() === "true"
    console.log(`[global-teardown] Using api-url: ${apiURL}`)

    const license = process.env.AGENTA_LICENSE || "oss"
    console.log(
        `[global-teardown] Environment variables - token: ${token ? "present" : "absent"}, AGENTA_LICENSE: ${license}, AGENTA_ALLOW_DESTRUCTIVE_TEARDOWN: ${allowDestructiveTeardown}`,
    )

    // --- Phase 1: Delete ephemeral project ---
    await deleteEphemeralProject(apiURL)

    // --- Phase 2: Delete all accounts (destructive, CI-only) ---
    if (allowDestructiveTeardown && token && license === "oss") {
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
        console.log(
            "[global-teardown] Skipping delete-all accounts (set AGENTA_ALLOW_DESTRUCTIVE_TEARDOWN=true to enable)",
        )
    }

    // --- Phase 3: Clean up model hub secrets ---
    await cleanupModelHubSecrets(apiURL)
}

/**
 * Deletes the ephemeral project created during global-setup.
 * Reads project metadata from test-project.json, calls DELETE /api/projects/{id},
 * then removes the metadata file.
 */
async function deleteEphemeralProject(apiURL: string): Promise<void> {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const projectPath = resolve(__dirname, "../test-project.json")

    if (!existsSync(projectPath)) {
        console.log("[global-teardown] No test-project.json found, skipping project cleanup")
        return
    }

    try {
        const projectData = JSON.parse(readFileSync(projectPath, "utf8"))
        const projectId = projectData.project_id
        const projectName = projectData.project_name

        if (!projectId) {
            console.warn("[global-teardown] test-project.json has no project_id, skipping")
            return
        }

        console.log(
            `[global-teardown] Deleting ephemeral project: ${projectName} (${projectId})`,
        )

        const statePath = resolve(__dirname, "../state.json")
        const sessionToken = getSessionToken(statePath)

        if (!sessionToken) {
            console.warn(
                "[global-teardown] No session token available, cannot delete ephemeral project",
            )
            return
        }

        const authHeaders = {
            Authorization: `Bearer ${sessionToken}`,
            "Content-Type": "application/json",
        }

        // Restore original default project before deleting (API rejects deleting the default)
        const originalDefaultId = projectData.original_default_project_id
        if (originalDefaultId) {
            console.log(
                `[global-teardown] Restoring original default project: ${originalDefaultId}`,
            )
            const patchResponse = await fetch(`${apiURL}/projects/${originalDefaultId}`, {
                method: "PATCH",
                headers: authHeaders,
                body: JSON.stringify({make_default: true}),
            })
            if (patchResponse.ok) {
                console.log("[global-teardown] Restored original default project")
            } else {
                console.warn(
                    `[global-teardown] Failed to restore default project (${patchResponse.status})`,
                )
            }
        }

        // Now delete the ephemeral project
        const response = await fetch(`${apiURL}/projects/${projectId}`, {
            method: "DELETE",
            headers: authHeaders,
        })

        if (response.ok) {
            console.log(`[global-teardown] Deleted ephemeral project: ${projectName}`)
        } else {
            const text = await response.text()
            console.warn(
                `[global-teardown] Failed to delete ephemeral project (${response.status}): ${text}`,
            )
        }
    } catch (error) {
        console.warn("[global-teardown] Error deleting ephemeral project:", error)
    } finally {
        // Always clean up the metadata file
        try {
            unlinkSync(projectPath)
            console.log("[global-teardown] Removed test-project.json")
        } catch {
            // Ignore if already deleted
        }
    }
}

/**
 * Cleans up OpenAI model hub secrets that were added during test runs.
 */
async function cleanupModelHubSecrets(apiURL: string): Promise<void> {
    try {
        console.log("[global-teardown] Deleting model hub secrets...")
        const __filename = fileURLToPath(import.meta.url)
        const __dirname = dirname(__filename)

        const statePath = resolve(__dirname, "../state.json")
        const sessionToken = getSessionToken(statePath)

        if (!sessionToken) {
            console.log(
                "[global-teardown] No session token in state.json, skipping model hub cleanup",
            )
            return
        }

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
