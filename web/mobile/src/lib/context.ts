import {safeParseWithLogging} from "@agenta/entities/shared"
import {getProjectsClient} from "@agenta/sdk/resources"
import {z} from "zod"

import {refreshSessionOutcome} from "./auth"

/** Mobile's own last-visited workspace/project, for `/m/` root resolution. */
export const LAST_CONTEXT_KEY = "agenta:mobile:last-context"

/** Desktop's continuity map ({[workspaceId]: projectId}) — read-only here. */
const DESKTOP_LAST_USED_KEY = "lastUsedProjectsByWorkspace"

export interface LastContext {
    workspaceId: string
    projectId: string
}

/**
 * Where a resolved context lands. The one place the mobile "project home" route is spelled
 * out — the root resolver and every `/w/...` index gate forward here.
 */
export const projectHomeUrl = ({workspaceId, projectId}: LastContext): string =>
    `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/apps`

export function writeLastContext(context: LastContext): void {
    try {
        localStorage.setItem(LAST_CONTEXT_KEY, JSON.stringify(context))
    } catch {
        // storage unavailable (private mode / quota) — continuity is best-effort
    }
}

/**
 * Forget the fast-path pair. Called when the stored project will not load, so `/m/` stops
 * forwarding into a route that cannot render. Safe to over-call: `ContextSync` rewrites the
 * pair on the next project that does load.
 */
export function clearLastContext(): void {
    try {
        localStorage.removeItem(LAST_CONTEXT_KEY)
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
    // The switcher names the ORGANIZATION, as the desktop rail does. Every project in this
    // account sits in one workspace called "Default", so labelling by workspace showed
    // "Default" where the desktop showed the org.
    organization_id: z.string().nullish(),
    organization_name: z.string().nullish(),
    is_demo: z.boolean().nullish(),
    // Only the settings list reads these two; every other consumer ignores them. They stay
    // optional because the schema is a drift check, not a contract we want to fail on.
    user_role: z.string().nullish(),
    is_default_project: z.boolean().optional(),
})

export type MobileProject = z.infer<typeof projectRowSchema>

export type ProjectsResult =
    | {kind: "ok"; projects: MobileProject[]}
    | {kind: "unauthenticated"}
    | {kind: "error"}

async function fetchProjectsOnce(): Promise<ProjectsResult> {
    try {
        const data = await getProjectsClient().getProjects()
        const projects = safeParseWithLogging(z.array(projectRowSchema), data, "[fetchProjects]")
        if (!projects) return {kind: "error"}
        return {kind: "ok", projects}
    } catch (error) {
        const status = (error as {statusCode?: number} | null)?.statusCode
        if (status === 401 || status === 403) return {kind: "unauthenticated"}
        return {kind: "error"}
    }
}

export async function fetchProjects(): Promise<ProjectsResult> {
    const first = await fetchProjectsOnce()
    if (first.kind !== "unauthenticated") return first
    // An expired access token is not signed-out: try one cookie refresh, then retry once before
    // letting the unauthenticated verdict stand.
    const outcome = await refreshSessionOutcome()
    // A refresh we could not even REACH is not a verdict about the user. A backend that is up but
    // not yet serving answers 401, and the refresh that follows fails for the same reason — read
    // together that used to look exactly like a sign-out, which bounced a valid session to the
    // sign-in page. Report it as the transient error it is; the query layer retries.
    if (outcome === "unreachable") return {kind: "error"}
    if (outcome === "signed-out") return first
    return fetchProjectsOnce()
}
