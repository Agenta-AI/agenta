/**
 * Project drives of a session: the `{kind: "project"}` entries of the agent configuration's
 * `drives` list, resolved by slug to their active mounts. The runner links each one into the
 * session folder at `drives/<slug>/`, so the drive folds its files in under that path.
 */
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryMountsBySlugs, type Mount} from "@agenta/entities/session"
import {workflowMolecule} from "@agenta/entities/workflow"

import {cleanPath} from "./driveTree"

/** The session folder that holds the project drive links (runner: `PROJECT_DRIVES_DIR_NAME`). */
export const PROJECT_DRIVES_DIR = "drives"

export type DriveAccess = "read" | "read-write"

export interface ProjectDriveEntry {
    slug: string
    access: DriveAccess
}

export interface ProjectDrive extends ProjectDriveEntry {
    mount: Mount
}

/** The project entries of `parameters.agent.drives`, each slug once; anything malformed is skipped. */
export const projectDriveEntries = (parameters: unknown): ProjectDriveEntry[] => {
    const agent = (parameters as {agent?: unknown} | null | undefined)?.agent
    const drives = (agent as {drives?: unknown} | null | undefined)?.drives
    if (!Array.isArray(drives)) return []
    const out: ProjectDriveEntry[] = []
    const seen = new Set<string>()
    for (const entry of drives) {
        if (!entry || typeof entry !== "object") continue
        const {kind, slug, access} = entry as Record<string, unknown>
        if (kind !== "project" || typeof slug !== "string" || !slug || seen.has(slug)) continue
        seen.add(slug)
        out.push({slug, access: access === "read" ? "read" : "read-write"})
    }
    return out
}

/** Keep the entries whose slug has an active mount, in configuration order. */
export const matchProjectDrives = (
    entries: readonly ProjectDriveEntry[],
    mounts: readonly Mount[],
): ProjectDrive[] => {
    const bySlug = new Map(mounts.filter((m) => m.slug).map((m) => [m.slug as string, m]))
    return entries.flatMap((entry) => {
        const mount = bySlug.get(entry.slug)
        return mount ? [{...entry, mount}] : []
    })
}

/** The presented folder of a project drive: `drives/<slug>`. */
export const projectDriveDir = (slug: string): string => `${PROJECT_DRIVES_DIR}/${slug}`

/** The project drive a presented path falls under, and the path relative to that drive's root. */
export const resolveProjectDrivePath = <D extends {slug: string}>(
    path: string,
    drives: readonly D[],
): {drive: D; path: string} | null => {
    const rel = cleanPath(path)
    if (!rel.startsWith(`${PROJECT_DRIVES_DIR}/`)) return null
    for (const drive of drives) {
        const dir = projectDriveDir(drive.slug)
        if (rel === dir) return {drive, path: ""}
        if (rel.startsWith(`${dir}/`)) return {drive, path: rel.slice(dir.length + 1)}
    }
    return null
}

/** The project entries of a revision's configuration (none without a revision). */
const projectDriveEntriesAtomFamily = atomFamily((revisionId: string) =>
    atom((get) =>
        revisionId
            ? projectDriveEntries(get(workflowMolecule.selectors.parameters(revisionId)))
            : [],
    ),
)

const projectMountsQueryFamily = atomFamily((slugsKey: string) =>
    atomWithQuery<Mount[] | null>((get) => {
        const projectId = get(projectIdAtom) ?? ""
        const slugs = slugsKey ? slugsKey.split("\n") : []
        return {
            queryKey: ["mounts", "project", projectId, slugsKey],
            queryFn: ({signal}) => queryMountsBySlugs({slugs, projectId, abortSignal: signal}),
            enabled: Boolean(projectId && slugs.length),
            staleTime: 60_000,
            refetchOnWindowFocus: false,
        }
    }),
)

/** The revision's project drives that have an active mount. No project entries: no request. */
export const projectDrivesAtomFamily = atomFamily((revisionId: string) =>
    atom((get): ProjectDrive[] => {
        const entries = get(projectDriveEntriesAtomFamily(revisionId))
        if (!entries.length) return []
        const slugsKey = entries.map((e) => e.slug).join("\n")
        const mounts = get(projectMountsQueryFamily(slugsKey)).data ?? []
        return matchProjectDrives(entries, mounts)
    }),
)
