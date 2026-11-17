/**
 * The drives of a session's agent: the `drives` entries of its configuration, resolved by slug to
 * their active mounts. The runner links each drive into the session folder at `drives/<slug>/`, and
 * the home drive (`home_drive`) also at `agent-files/`. The files pane shows the home drive once,
 * under `agent-files/`, and every other drive under `drives/<slug>/`.
 *
 * A configuration without a `drives` list was saved before drives were listed: its home drive is
 * the agent's drive found by the agent id, and it has no other drives.
 */
import {projectIdAtom} from "@agenta/shared/state"
import {atom, type Atom} from "jotai"
import {selectAtom} from "jotai/utils"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryMountsBySlugs, type Mount} from "@agenta/entities/session"
import {workflowMolecule} from "@agenta/entities/workflow"

import {agentMountQueryFamily} from "./agentDrive"
import {cleanPath} from "./driveTree"

/** The session folder that holds a link per drive (runner: `DRIVES_DIR_NAME`). */
export const DRIVES_DIR = "drives"

export type DriveAccess = "read" | "read-write"

export interface DriveEntry {
    slug: string
    access: DriveAccess
}

export interface Drive extends DriveEntry {
    mount: Mount
}

/** A configuration's `drives` entries and the slug of its home drive. */
export interface AgentDriveConfig {
    entries: DriveEntry[]
    /** `home_drive` when it names an entry, else null. */
    homeSlug: string | null
}

/**
 * The drives of `parameters.agent`, each slug once; anything malformed is skipped. Null when the
 * configuration has no `drives` list, which means the agent's drive found by its id.
 */
export const agentDriveConfig = (parameters: unknown): AgentDriveConfig | null => {
    const agent = (parameters as {agent?: unknown} | null | undefined)?.agent
    const {drives, home_drive: home} = (agent ?? {}) as {drives?: unknown; home_drive?: unknown}
    if (!Array.isArray(drives)) return null
    const entries: DriveEntry[] = []
    const seen = new Set<string>()
    for (const entry of drives) {
        if (!entry || typeof entry !== "object") continue
        const {slug, access} = entry as Record<string, unknown>
        if (typeof slug !== "string" || !slug || seen.has(slug)) continue
        seen.add(slug)
        entries.push({slug, access: access === "read" ? "read" : "read-write"})
    }
    const homeSlug = typeof home === "string" && seen.has(home) ? home : null
    return {entries, homeSlug}
}

/** Keep the entries whose slug has an active mount, in configuration order. */
export const matchDrives = (entries: readonly DriveEntry[], mounts: readonly Mount[]): Drive[] => {
    const bySlug = new Map(mounts.filter((m) => m.slug).map((m) => [m.slug as string, m]))
    return entries.flatMap((entry) => {
        const mount = bySlug.get(entry.slug)
        return mount ? [{...entry, mount}] : []
    })
}

/** The presented folder of a drive: `drives/<slug>`. */
export const driveDir = (slug: string): string => `${DRIVES_DIR}/${slug}`

/** The drive a presented path falls under, and the path relative to that drive's root. */
export const resolveDrivePath = <D extends {slug: string}>(
    path: string,
    drives: readonly D[],
): {drive: D; path: string} | null => {
    const rel = cleanPath(path)
    if (!rel.startsWith(`${DRIVES_DIR}/`)) return null
    for (const drive of drives) {
        const dir = driveDir(drive.slug)
        if (rel === dir) return {drive, path: ""}
        if (rel.startsWith(`${dir}/`)) return {drive, path: rel.slice(dir.length + 1)}
    }
    return null
}

export interface AgentDrivesState {
    /** The home drive's mount, shown under `agent-files/`. */
    home: Mount | null
    /** The configured home slug; null without a `drives` list or without a home. */
    homeSlug: string | null
    /** Every configured entry, the home included, resolved or not. */
    configured: DriveEntry[]
    /** The other drives with an active mount, in configuration order. */
    drives: Drive[]
    /** Every drive with an active mount, the home included: each is linked at `drives/<slug>`. */
    linked: Drive[]
    /** The configuration or a lookup is still in flight. */
    isPending: boolean
    isFetching: boolean
    /** A lookup failed, so drives the configuration names may be missing. */
    isError: boolean
    refetch: () => void
}

interface ResolvedDrives {
    home: Mount | null
    homeSlug: string | null
    configured: DriveEntry[]
    drives: Drive[]
    linked: Drive[]
}

const NO_ENTRIES: DriveEntry[] = []
const NO_DRIVES: Drive[] = []
const NOTHING: ResolvedDrives = {
    home: null,
    homeSlug: null,
    configured: NO_ENTRIES,
    drives: NO_DRIVES,
    linked: NO_DRIVES,
}
const noop = () => {}

/** `pending` (the revision is loading), `legacy:<artifact id>`, or `listed:<entries and home>`. */
type ConfigKey = string
const PENDING_KEY = "pending"

const configKeyOf = (config: AgentDriveConfig | null, artifactId: string): ConfigKey =>
    config ? `listed:${JSON.stringify(config)}` : `legacy:${artifactId}`

const configOfKey = (key: ConfigKey): AgentDriveConfig | null =>
    key.startsWith("listed:") ? (JSON.parse(key.slice("listed:".length)) as AgentDriveConfig) : null

const slugsKeyOf = (entries: readonly DriveEntry[]) => entries.map((e) => e.slug).join("\n")

const driveMountsQueryFamily = atomFamily((slugsKey: string) =>
    atomWithQuery<Mount[] | null>((get) => {
        const projectId = get(projectIdAtom) ?? ""
        const slugs = slugsKey ? slugsKey.split("\n") : []
        return {
            queryKey: ["mounts", "slugs", projectId, slugsKey],
            queryFn: ({signal}) => queryMountsBySlugs({slugs, projectId, abortSignal: signal}),
            enabled: Boolean(projectId && slugs.length),
            staleTime: 60_000,
            refetchOnWindowFocus: false,
        }
    }),
)

/** The lookup's answer alone, so the drives recompute when it changes and not on a fetch flag. */
const driveMountsDataFamily = atomFamily((slugsKey: string) =>
    selectAtom(driveMountsQueryFamily(slugsKey), (query) => query.data),
)

const legacyHomeDataFamily = atomFamily((artifactId: string) =>
    selectAtom(agentMountQueryFamily(artifactId), (query) => query.data ?? null),
)

const resolvedDrivesFamily = atomFamily((key: ConfigKey) =>
    atom((get): ResolvedDrives => {
        if (key === PENDING_KEY) return NOTHING
        const config = configOfKey(key)
        if (!config) {
            const artifactId = key.slice("legacy:".length)
            const home = artifactId ? get(legacyHomeDataFamily(artifactId)) : null
            return home ? {...NOTHING, home} : NOTHING
        }
        if (!config.entries.length) return NOTHING
        const mounts = get(driveMountsDataFamily(slugsKeyOf(config.entries))) ?? []
        const linked = matchDrives(config.entries, mounts)
        return {
            home: linked.find((d) => d.slug === config.homeSlug)?.mount ?? null,
            homeSlug: config.homeSlug,
            configured: config.entries,
            drives: linked.filter((d) => d.slug !== config.homeSlug),
            linked,
        }
    }),
)

const IDLE: AgentDrivesState = {
    ...NOTHING,
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: noop,
}

const drivesStateFamily = atomFamily((key: ConfigKey) =>
    atom((get): AgentDrivesState => {
        if (key === PENDING_KEY) return {...IDLE, isPending: true}
        const resolved = get(resolvedDrivesFamily(key))
        const config = configOfKey(key)
        if (!config) {
            const artifactId = key.slice("legacy:".length)
            if (!artifactId) return IDLE
            const query = get(agentMountQueryFamily(artifactId))
            return {
                ...resolved,
                isPending: query.isPending,
                isFetching: query.isFetching,
                isError: query.isError,
                refetch: () => void query.refetch(),
            }
        }
        if (!config.entries.length) return IDLE
        const query = get(driveMountsQueryFamily(slugsKeyOf(config.entries)))
        return {
            ...resolved,
            isPending: query.isPending && query.fetchStatus !== "idle",
            isFetching: query.isFetching,
            // The API helper answers null for a failed request.
            isError: query.isError || (!query.isPending && query.data === null),
            refetch: () => void query.refetch(),
        }
    }),
)

/** The drives of a configuration given as parameters (undefined while it loads). */
export const agentDrivesStateForParameters = (
    parameters: unknown,
    artifactId: string,
): Atom<AgentDrivesState> =>
    drivesStateFamily(
        parameters === undefined
            ? PENDING_KEY
            : configKeyOf(agentDriveConfig(parameters), artifactId),
    )

/** The config key of a revision: pending while it loads; without a revision, the legacy lookup. */
const revisionConfigKeyFamily = atomFamily((key: string) =>
    atom((get): ConfigKey => {
        const [revisionId, artifactId] = key.split("\n")
        if (!revisionId) return configKeyOf(null, artifactId)
        const parameters = get(workflowMolecule.selectors.parameters(revisionId))
        if (parameters == null) {
            const query = get(workflowMolecule.selectors.query(revisionId))
            return query.isPending ? PENDING_KEY : configKeyOf(null, artifactId)
        }
        return configKeyOf(agentDriveConfig(parameters), artifactId)
    }),
)

const agentDrivesStateFamily = atomFamily((key: string) =>
    atom((get) => get(drivesStateFamily(get(revisionConfigKeyFamily(key))))),
)

/**
 * The drives of the revision a session runs. Without a revision id, the agent's drive found by its
 * artifact id; with neither, nothing and no request.
 */
export const agentDrivesStateAtom = (
    revisionId?: string | null,
    artifactId?: string | null,
): Atom<AgentDrivesState> => agentDrivesStateFamily(`${revisionId ?? ""}\n${artifactId ?? ""}`)
