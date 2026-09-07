/** Deletes the ephemeral project created during global setup. */

import {existsSync, readFileSync, unlinkSync} from "fs"

import {getProjectMetadataPath, getStorageStatePath} from "./config/runtime.ts"

/**
 * Extracts the session token from the storage state for authenticated API calls.
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
 * Derives the API base URL from AGENTA_WEB_URL.
 * The web app may live at a subpath (e.g. /w) but the API is always at /api on the origin.
 */
function getApiURL(webURL: string): string {
    if (process.env.AGENTA_API_URL) return process.env.AGENTA_API_URL
    try {
        const u = new URL(webURL)
        return `${u.origin}/api`
    } catch {
        return `${webURL}/api`
    }
}

async function globalTeardown() {
    console.log("[global-teardown] Starting global teardown...")
    const baseURL = process.env.AGENTA_WEB_URL || "http://localhost:3000"
    console.log(`[global-teardown] Using web-url: ${baseURL}`)

    const apiURL = getApiURL(baseURL)
    console.log(`[global-teardown] Using api-url: ${apiURL}`)

    await deleteEphemeralProject(apiURL)
}

/**
 * Deletes a project only when setup explicitly marked it as ephemeral.
 * Keeps the metadata after a failed deletion so a later teardown can retry.
 */
interface DeleteEphemeralProjectOptions {
    projectPath?: string
    statePath?: string
    fetchFn?: typeof fetch
}

export async function deleteEphemeralProject(
    apiURL: string,
    options: DeleteEphemeralProjectOptions = {},
): Promise<void> {
    const projectPath = options.projectPath ?? getProjectMetadataPath()
    const statePath = options.statePath ?? getStorageStatePath()
    const fetchFn = options.fetchFn ?? fetch

    if (!existsSync(projectPath)) {
        console.log("[global-teardown] No test project metadata found, skipping project cleanup")
        return
    }

    let removeMetadata = false

    try {
        const projectData = JSON.parse(readFileSync(projectPath, "utf8"))

        if (projectData.ephemeral !== true) {
            console.log("[global-teardown] Project is not marked ephemeral, skipping cleanup")
            removeMetadata = true
            return
        }

        const projectId = projectData.project_id
        const projectName = projectData.project_name

        if (!projectId) {
            console.warn("[global-teardown] Project metadata has no project_id, skipping")
            return
        }

        console.log(`[global-teardown] Deleting ephemeral project: ${projectName} (${projectId})`)

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
            const patchResponse = await fetchFn(`${apiURL}/projects/${originalDefaultId}`, {
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
                return
            }
        }

        // Now delete the ephemeral project
        const response = await fetchFn(`${apiURL}/projects/${projectId}`, {
            method: "DELETE",
            headers: authHeaders,
        })

        if (response.ok || response.status === 404) {
            console.log(`[global-teardown] Deleted ephemeral project: ${projectName}`)
            removeMetadata = true
        } else {
            const text = await response.text()
            console.warn(
                `[global-teardown] Failed to delete ephemeral project (${response.status}): ${text}`,
            )
        }
    } catch (error) {
        console.warn("[global-teardown] Error deleting ephemeral project:", error)
    } finally {
        if (removeMetadata) {
            try {
                unlinkSync(projectPath)
                console.log("[global-teardown] Removed test project metadata")
            } catch {
                // Ignore if already deleted
            }
        } else {
            console.warn(
                `[global-teardown] Retained test project metadata for a later cleanup attempt: ${projectPath}`,
            )
        }
    }
}

export default globalTeardown
