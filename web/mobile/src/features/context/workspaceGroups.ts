import type {MobileProject} from "@/lib/context"

/** A project row that can be routed to: `/w/:workspace_id/p/:project_id` needs both halves. */
export type RoutableProject = MobileProject & {workspace_id: string}

/**
 * The one place a project is judged routable. A row without a workspace would render as a tap
 * that goes nowhere, so it never reaches a group.
 */
const routableProjects = (projects: MobileProject[]): RoutableProject[] =>
    projects.filter((project): project is RoutableProject => Boolean(project.workspace_id))

/** First value that is a real, non-blank string. `""` is a missing name, not a name. */
const firstNonBlank = (values: (string | null | undefined)[]): string | undefined =>
    values.find((value): value is string => typeof value === "string" && value.trim() !== "")

/** Bucket rows by key, keeping the server's key order and its row order within each bucket. */
const bucketBy = <T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> => {
    const buckets = new Map<string, T[]>()
    for (const row of rows) {
        const key = keyOf(row)
        const bucket = buckets.get(key)
        if (bucket) bucket.push(row)
        else buckets.set(key, [row])
    }
    return buckets
}

/** Routing identity only. Display names live on `OrganizationGroup`, which is what the UI reads. */
export interface WorkspaceGroup {
    workspaceId: string
    projects: RoutableProject[]
}

/** Group the flat project list by workspace, preserving the server's order within each. */
export const groupByWorkspace = (projects: MobileProject[]): WorkspaceGroup[] =>
    [...bucketBy(routableProjects(projects), (project) => project.workspace_id)].map(
        ([workspaceId, rows]) => ({workspaceId, projects: rows}),
    )

export interface OrganizationGroup {
    /** Stable list key: the org id, or the workspace standing in for a row that carries none. */
    key: string
    organizationId: string | null
    organizationName: string
    /** Workspace the org row enters — its first project's, so the two cannot disagree. */
    workspaceId: string
    /** Every project in the org, across all its workspaces, in server order. */
    projects: RoutableProject[]
}

/**
 * Group the flat project list by ORGANIZATION — what the switcher offers, matching the desktop
 * rail. Grouping by workspace instead rendered one indistinguishable "Default" row per org,
 * because every org's default workspace carries that same name.
 *
 * Every group-level field is resolved from the WHOLE group rather than from whichever row arrived
 * first, so a row with a missing or blank name cannot pin the group to a fallback label.
 */
export const groupByOrganization = (projects: MobileProject[]): OrganizationGroup[] =>
    [
        ...bucketBy(
            routableProjects(projects),
            // An org-less row still belongs to somebody: key it by workspace rather than drop it.
            (project) => project.organization_id ?? `workspace:${project.workspace_id}`,
        ),
    ].map(([key, rows]) => ({
        key,
        // Every row in a bucket agrees on this by construction — it IS the bucket key.
        organizationId: rows[0].organization_id ?? null,
        organizationName:
            firstNonBlank(rows.map((row) => row.organization_name)) ??
            firstNonBlank(rows.map((row) => row.workspace_name)) ??
            "Organization",
        workspaceId: rows[0].workspace_id,
        projects: rows,
    }))
