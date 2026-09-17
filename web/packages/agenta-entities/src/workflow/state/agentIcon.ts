/**
 * Per-agent icon and colour, stored on the workflow ARTIFACT as `tags["@ag"].icon = {name, color}`
 * so every device and teammate sees one identity. Only name and colour travel; the glyph is
 * looked up by name in the generated catalog, so no SVG markup is stored or rendered from data.
 *
 * `agentIconAtomFamily` is the ONLY public seam. Its write is optimistic and never rejects, so a
 * call site can hand it straight to the picker's `onChange`.
 */
import {isHexColor, loadAgentIconCatalog} from "@agenta/ui/agent-icon"
import {message} from "@agenta/ui/app-message"
import {atom} from "jotai"
import {atomWithStorage, unwrap} from "jotai/utils"
import {atomFamily} from "jotai-family"
import {queryClientAtom} from "jotai-tanstack-query"

import {queryWorkflows, updateWorkflow} from "../api"
import type {Workflow} from "../core"

import {
    appWorkflowsListQueryAtom,
    patchWorkflowArtifactCaches,
    workflowArtifactQueryAtomFamily,
    workflowProjectIdAtom,
} from "./store"

/** What the surfaces consume. `path` is the glyph's inner SVG, resolved from the catalog. */
export interface AgentIconRecord {
    /** Kebab-case Phosphor name. */
    icon: string
    color: string
    path: string
}

/** What is stored on the artifact, under `tags["@ag"].icon`. */
export interface AgentIconSetting {
    /** Kebab-case Phosphor name. */
    name: string
    color: string
}

// ============================================================================
// TAG SHAPE
// ============================================================================

const AG_TAG = "@ag"
const ICON_KEY = "icon"

type TagMap = NonNullable<Workflow["tags"]>

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null

const toSetting = (name: unknown, color: unknown): AgentIconSetting | null =>
    typeof name === "string" && name && typeof color === "string" && isHexColor(color)
        ? {name, color}
        : null

/** The icon on a tag map, or null when there is none or it is malformed. */
export const readAgentIconTag = (tags: Workflow["tags"]): AgentIconSetting | null => {
    const icon = asRecord(asRecord(tags?.[AG_TAG])?.[ICON_KEY])
    return icon ? toSetting(icon.name, icon.color) : null
}

/**
 * The tag map with `@ag.icon` set, or removed for `null`. Every other key — outside and inside
 * `@ag` — is kept: the artifact edit REPLACES tags, so the whole map goes back. An emptied map
 * is `{}`, never null: the edit drops a null field and would leave the old tags in place.
 */
export const withAgentIconTag = (
    tags: Workflow["tags"],
    setting: AgentIconSetting | null,
): TagMap => {
    const {[AG_TAG]: ag, ...rest} = tags ?? {}
    const {[ICON_KEY]: _icon, ...agRest} = asRecord(ag) ?? {}
    const nextAg = setting ? {...agRest, [ICON_KEY]: {...setting}} : agRest
    return Object.keys(nextAg).length > 0 ? {...rest, [AG_TAG]: nextAg} : {...rest}
}

// ============================================================================
// GLYPHS
// ============================================================================

const NO_GLYPHS: ReadonlyMap<string, string> = new Map()

/** Name → inner SVG. Unwrapped so a read never suspends; read only once a custom icon is on screen. */
const glyphsAtom = unwrap(
    atom(async (): Promise<ReadonlyMap<string, string>> => {
        // A chunk that fails to load leaves every agent on its fallback glyph, not in an error
        // boundary. The loader drops a rejection, so the picker still retries on its own.
        const catalog = await loadAgentIconCatalog().catch(() => [])
        return new Map(catalog.map((entry) => [entry.name, entry.path] as const))
    }),
    () => NO_GLYPHS,
)

// ============================================================================
// LEGACY BROWSER VALUE
// ============================================================================

/** Where the choice lived before it moved to the artifact. Read as a fallback, never written. */
const legacyIconMapAtom = atomWithStorage<Record<string, unknown>>(
    "agenta:agent-icon:1",
    {},
    undefined,
    {getOnInit: true},
)

const readLegacySetting = (value: unknown): AgentIconSetting | null => {
    const record = asRecord(value)
    return record ? toSetting(record.icon, record.color) : null
}

// ============================================================================
// THE SEAM
// ============================================================================

/**
 * The pick in flight, per agent, read ahead of the caches. Synchronous on purpose: the query
 * observer notifies a tick late, and a colour picked in that tick would build on the old icon.
 */
const pendingIconAtom = atom<Record<string, {seq: number; setting: AgentIconSetting | null}>>({})
let pendingSeq = 0

/** One save at a time per agent, so two quick picks reach the server in the order made. */
const saveChain = new Map<string, Promise<unknown>>()

/** The stored icon: the apps list, then a by-id fetch for an agent it lacks, then the legacy value. */
const agentIconSettingAtomFamily = atomFamily((workflowId: string) =>
    atom((get): AgentIconSetting | null => {
        const pending = get(pendingIconAtom)[workflowId]
        if (pending) return pending.setting
        const list = get(appWorkflowsListQueryAtom)
        const ref = list.data?.refs.find((candidate) => candidate.id === workflowId)
        let tags: Workflow["tags"]
        if (ref) {
            tags = ref.tags
        } else if (list.isPending) {
            // Wait for the list rather than fire a by-id fetch per agent on first paint.
            return null
        } else {
            tags = get(workflowArtifactQueryAtomFamily(workflowId)).data?.tags
        }
        return readAgentIconTag(tags) ?? readLegacySetting(get(legacyIconMapAtom)?.[workflowId])
    }),
)

/** Read/write one agent's icon. Writing `null` clears it back to the default chrome. */
export const agentIconAtomFamily = atomFamily((workflowId: string) =>
    atom(
        (get): AgentIconRecord | null => {
            if (!workflowId) return null
            const setting = get(agentIconSettingAtomFamily(workflowId))
            if (!setting) return null
            const path = get(glyphsAtom).get(setting.name)
            return path ? {icon: setting.name, color: setting.color, path} : null
        },
        async (get, set, next: AgentIconRecord | null) => {
            const projectId = get(workflowProjectIdAtom)
            if (!workflowId || !projectId) return
            const setting = next ? {name: next.icon, color: next.color} : null

            const seq = ++pendingSeq
            set(pendingIconAtom, (all) => ({...all, [workflowId]: {seq, setting}}))
            // Only the latest pick lifts the overlay; an earlier one landing must not expose a stale cache.
            const settle = () => {
                if (get(pendingIconAtom)[workflowId]?.seq !== seq) return
                set(pendingIconAtom, ({[workflowId]: _mine, ...rest}) => rest)
            }

            const save = async (): Promise<TagMap> => {
                // Merge into the LATEST tags, not the cached ones: the edit replaces the whole map.
                const latest = await queryWorkflows({
                    projectId,
                    workflowRefs: [{id: workflowId}],
                    includeArchived: true,
                })
                const current = latest.workflows?.find((workflow) => workflow.id === workflowId)
                const tags = withAgentIconTag(current?.tags, setting)
                await updateWorkflow(projectId, {id: workflowId, tags})
                return tags
            }
            const run = (saveChain.get(workflowId) ?? Promise.resolve()).then(save, save)
            const link = run
                .catch(() => undefined)
                .then(() => {
                    if (saveChain.get(workflowId) === link) saveChain.delete(workflowId)
                })
            saveChain.set(workflowId, link)

            let tags: TagMap
            try {
                tags = await run
            } catch {
                // Lifting the overlay is the rollback: the caches still hold the value before the pick.
                settle()
                message.error("Couldn't save the agent icon")
                return
            }
            // The server's watch event refetches these lists; the patch covers the gap until it lands.
            patchWorkflowArtifactCaches(
                get(queryClientAtom),
                projectId,
                workflowId,
                (workflow) => ({
                    ...workflow,
                    tags,
                }),
            )
            settle()
            const legacy = asRecord(get(legacyIconMapAtom)) ?? {}
            if (workflowId in legacy) {
                const {[workflowId]: _legacy, ...rest} = legacy
                set(legacyIconMapAtom, rest)
            }
            // The mobile archived list reads its own query; let it catch up on its own.
            void get(queryClientAtom).invalidateQueries({queryKey: ["agent-workflows"]})
        },
    ),
)
