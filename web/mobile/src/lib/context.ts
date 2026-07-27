import {getProjectsClient} from "@agenta/sdk/resources"
import {z} from "zod"

/** Mobile's own last-visited workspace/project, for `/m/` root resolution. */
export const LAST_CONTEXT_KEY = "agenta:mobile:last-context"

/** Desktop's continuity map ({[workspaceId]: projectId}) — read-only here. */
const DESKTOP_LAST_USED_KEY = "lastUsedProjectsByWorkspace"

export interface LastContext {
    workspaceId: string
    projectId: string
}

export function writeLastContext(context: LastContext): void {
    try {
        localStorage.setItem(LAST_CONTEXT_KEY, JSON.stringify(context))
    } catch {
        // storage unavailable (private mode / quota) — continuity is best-effort
    }
}

export function readLastContext(): LastContext | null {
    try {
        const raw = localStorage.getItem(LAST_CONTEXT_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw) as Partial<LastContext> | null
        if (
            parsed &&
            typeof parsed.workspaceId === "string" &&
            typeof parsed.projectId === "string"
        ) {
            return {workspaceId: parsed.workspaceId, projectId: parsed.projectId}
        }
        return null
    } catch {
        return null
    }
}

export function readDesktopLastUsed(): Record<string, string> {
    try {
        const raw = localStorage.getItem(DESKTOP_LAST_USED_KEY)
        const parsed = raw ? (JSON.parse(raw) as unknown) : null
        if (!parsed || typeof parsed !== "object") return {}
        const entries = Object.entries(parsed as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "",
        )
        return Object.fromEntries(entries)
    } catch {
        return {}
    }
}

// Minimal boundary schema: Fern's compile-time types under-declare backend
// extra="allow" fields, so the local schema is the independent drift check.
const projectRowSchema = z.object({
    project_id: z.string(),
    project_name: z.string(),
    workspace_id: z.string().nullish(),
    workspace_name: z.string().nullish(),
    is_demo: z.boolean().nullish(),
})

export type MobileProject = z.infer<typeof projectRowSchema>

export type ProjectsResult =
    | {kind: "ok"; projects: MobileProject[]}
    | {kind: "unauthenticated"}
    | {kind: "error"}

export async function fetchProjects(): Promise<ProjectsResult> {
    try {
        const data = await getProjectsClient().getProjects()
        const parsed = z.array(projectRowSchema).safeParse(data)
        if (!parsed.success) {
            console.error("[fetchProjects] response shape drift", parsed.error)
            return {kind: "error"}
        }
        return {kind: "ok", projects: parsed.data}
    } catch (error) {
        const status = (error as {statusCode?: number} | null)?.statusCode
        if (status === 401 || status === 403) return {kind: "unauthenticated"}
        return {kind: "error"}
    }
}
