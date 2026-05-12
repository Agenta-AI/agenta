/**
 * SDK integration test setup — creates a real Agenta SDK instance.
 *
 * Required env vars:
 *   AGENTA_HOST     — e.g. http://localhost or https://cloud.agenta.ai
 *   AGENTA_API_KEY  — valid API key
 *
 * Optional:
 *   AGENTA_PROJECT_ID — specific project. If omitted, auto-selects first.
 */

import {Agenta} from "@src/index.js"

export const AGENTA_HOST = process.env.AGENTA_HOST
export const AGENTA_API_KEY = process.env.AGENTA_API_KEY
export const AGENTA_PROJECT_ID = process.env.AGENTA_PROJECT_ID

export const canRun = !!(AGENTA_HOST && AGENTA_API_KEY)

export async function createTestClient(): Promise<Agenta> {
    if (!canRun) throw new Error("Missing AGENTA_HOST / AGENTA_API_KEY")

    let projectId = AGENTA_PROJECT_ID

    // Auto-select first project if none specified
    if (!projectId) {
        const ag = new Agenta({host: AGENTA_HOST!, apiKey: AGENTA_API_KEY!})
        const projects = await ag.projects.list()
        if (projects.length === 0) throw new Error("No projects found")
        projectId = projects[0].project_id
        console.error(
            `[sdk-integration] Auto-selected project: ${projects[0].project_name} (${projectId})`,
        )
    }

    return new Agenta({
        host: AGENTA_HOST!,
        apiKey: AGENTA_API_KEY!,
        projectId,
    })
}
