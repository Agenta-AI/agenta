/**
 * sectionChanges — one source of truth for "what changed in this agent config, per config-panel
 * section".
 *
 * The commit-diff classifier's sections were deliberately built to mirror this panel's ("Grouped to
 * mirror the agent-template control sections", `commitDiff/classify.ts`), so the panel reuses it
 * verbatim instead of re-diffing: `model` → Model & harness, `params` → Advanced (the runner /
 * sandbox / harness knobs), and the lists map 1:1. This module owns that mapping plus the lookups
 * the panel and its drawers need:
 *   - which sections changed (header indicators),
 *   - the section's render-ready `ChangeSection` (the inline "what changed" body),
 *   - the changed scalar dot-paths (`harness.permissions.allow`) so a drawer can mark the exact
 *     property row and open the sub-section that holds it.
 *
 * Two independent sources, one shape:
 *   - `draft` — the live template vs the COMMITTED one. Durable: it stands until committed.
 *   - `agent` — what the agent's own self-commit changed, frozen at the signal so the user's later
 *     edits don't drift into "the agent changed this".
 *
 * Neither is `draftConfigChangeSignalAtom`: that is a TRANSIENT "look here" pulse (~4s), not a
 * description of what changed. Anything durable must read from here.
 */
import {useMemo, useRef} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {
    classifyAgentChanges,
    type ChangeSection,
    type ScalarChange,
    type SectionId,
} from "@agenta/entities/workflow/commitDiff"
import {agentSelfCommitSignalAtom} from "@agenta/shared/state"
import {stripAgentaMetadataDeep} from "@agenta/shared/utils"
import {useAtomValue} from "jotai"

/** The accordion keys the config panel renders. */
export type PanelSectionKey =
    | "model-harness"
    | "instructions"
    | "tools"
    | "mcp"
    | "skills"
    | "advanced"

/**
 * Classifier section id → config-panel key. Typed against `SectionId`, so adding or renaming a
 * classifier section fails the build here instead of silently dropping that section from every
 * rollup (the previous two hand-rolled `Record<string, string>` copies did the latter).
 */
export const SECTION_ID_TO_PANEL_KEY: Record<SectionId, PanelSectionKey> = {
    model: "model-harness",
    instructions: "instructions",
    tools: "tools",
    mcps: "mcp",
    skills: "skills",
    params: "advanced",
}

export interface SectionChanges {
    /** Render-ready change detail, keyed by the PANEL key the caller renders (not `SectionId`). */
    sectionsByKey: Map<PanelSectionKey, ChangeSection>
    /** Panel keys carrying any change — the header-indicator rollup. */
    panelKeys: Set<PanelSectionKey>
    /** Every changed scalar dot-path, e.g. `harness.permissions.allow`, `runner.permissions.default`. */
    changedPaths: Set<string>
    /** Whether this exact dot-path changed (marks one property row). */
    isChanged: (path: string) => boolean
    /** Whether anything under this dotted subtree changed (opens the sub-section that owns it). */
    hasChangedUnder: (prefix: string) => boolean
    /** Changed paths under a subtree (all of them with no prefix) — the input to a scoped revert. */
    pathsUnder: (prefix?: string) => string[]
    /** The recorded before → after for a property, so a row can say what it changed FROM. */
    changeFor: (path: string) => ScalarChange | undefined
}

/** Fold classifier output into the panel's lookups. Pure — the hook below just supplies the diffs. */
export function toSectionChanges(sections: ChangeSection[]): SectionChanges {
    const sectionsByKey = new Map<PanelSectionKey, ChangeSection>()
    const changedPaths = new Set<string>()
    const byPath = new Map<string, ScalarChange>()
    for (const section of sections) {
        const key = SECTION_ID_TO_PANEL_KEY[section.id]
        if (!key) continue
        sectionsByKey.set(key, section)
        for (const scalar of section.scalarChanges ?? []) {
            changedPaths.add(scalar.key)
            byPath.set(scalar.key, scalar)
        }
    }
    const under = (prefix?: string) => {
        if (!prefix) return [...changedPaths]
        const scoped = `${prefix}.`
        return [...changedPaths].filter((path) => path === prefix || path.startsWith(scoped))
    }
    return {
        sectionsByKey,
        panelKeys: new Set(sectionsByKey.keys()),
        changedPaths,
        isChanged: (path) => changedPaths.has(path),
        hasChangedUnder: (prefix) => under(prefix).length > 0,
        pathsUnder: under,
        changeFor: (path) => byPath.get(path),
    }
}

// ---------------------------------------------------------------------------
// Revert
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v)

/** Read a dot-path out of an object, or `undefined`. */
function getPath(source: Record<string, unknown>, path: string): unknown {
    let cursor: unknown = source
    for (const key of path.split(".")) {
        if (!isObj(cursor)) return undefined
        cursor = cursor[key]
    }
    return cursor
}

/** Whether a dot-path exists (so "present but undefined" isn't confused with "absent"). */
function hasPath(source: Record<string, unknown>, path: string): boolean {
    const keys = path.split(".")
    let cursor: unknown = source
    for (const key of keys.slice(0, -1)) {
        if (!isObj(cursor)) return false
        cursor = cursor[key]
    }
    return isObj(cursor) && keys[keys.length - 1] in cursor
}

/**
 * Immutably set (or delete) a dot-path. Deleting prunes ancestor objects that are left empty, so
 * reverting the only key of a slice the commit never had doesn't leave `permissions: {}` behind —
 * which would read as "still changed" to a shape comparison even though nothing is.
 */
function withPath(
    source: Record<string, unknown>,
    path: string,
    value: unknown,
    remove: boolean,
): Record<string, unknown> {
    const [key, ...rest] = path.split(".")
    const next = {...source}
    if (!rest.length) {
        if (remove) delete next[key]
        else next[key] = value
        return next
    }
    const child = isObj(source[key]) ? (source[key] as Record<string, unknown>) : {}
    const updated = withPath(child, rest.join("."), value, remove)
    if (remove && Object.keys(updated).length === 0) delete next[key]
    else next[key] = updated
    return next
}

/**
 * Restore `paths` in `draft` to their `committed` values — deleting the key entirely when the commit
 * doesn't have it (i.e. the draft ADDED it). Returns a new object; never mutates. Paths are the
 * classifier's flattened dot-paths, so an array leaf (`harness.permissions.allow`) is restored whole.
 */
export function revertPathsTo(
    draft: Record<string, unknown>,
    committed: Record<string, unknown> | null,
    paths: string[],
): Record<string, unknown> {
    if (!committed) return draft
    let next = draft
    for (const path of paths) {
        next = hasPath(committed, path)
            ? withPath(next, path, getPath(committed, path), false)
            : withPath(next, path, undefined, true)
    }
    return next
}

export const EMPTY_SECTION_CHANGES: SectionChanges = toSectionChanges([])

/** Unwrap `parameters` to the agent template, stripping metadata so both sides compare like-for-like. */
function templateOf(parameters: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!parameters) return null
    const agent = parameters.agent
    const template =
        agent && typeof agent === "object" && !Array.isArray(agent) ? agent : parameters
    return stripAgentaMetadataDeep(template) as Record<string, unknown>
}

export interface AgentSectionChanges {
    /** Live template vs committed — the unsaved-changes diff. Empty for a never-saved draft. */
    draft: SectionChanges
    /** What the agent's last self-commit changed, or null when there is no live signal for this revision. */
    agent: SectionChanges | null
    /** Normalized version label for the agent commit, e.g. "v7". */
    agentVersion: string | null
    /**
     * The committed (server) template this diff is against — metadata-stripped, agent-wrapper
     * unwrapped. Exposed so per-item baselines (new/edited row status) read the SAME baseline as the
     * section diff instead of re-deriving it. Null for a never-saved draft.
     */
    committed: Record<string, unknown> | null
}

/**
 * Both change sources for one revision. Replaces the panel's two ad-hoc `classifyAgentChanges` call
 * sites (and their duplicated id→key maps) so the diff is computed once and every consumer — header
 * indicators, the inline summary, the drawer's property marks — reads the same result.
 */
export function useAgentSectionChanges(
    revisionId: string | null | undefined,
    config: Record<string, unknown>,
): AgentSectionChanges {
    // Committed (server) template. Null for a never-saved draft → no draft diff, validation only.
    const committedConfig = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.serverConfiguration(revisionId ?? ""),
            [revisionId],
        ),
    ) as Record<string, unknown> | null
    const committed = useMemo(() => templateOf(committedConfig), [committedConfig])

    const draft = useMemo(() => {
        if (!committed) return EMPTY_SECTION_CHANGES
        try {
            const local = stripAgentaMetadataDeep(config) as Record<string, unknown>
            return toSectionChanges(classifyAgentChanges(local, committed))
        } catch {
            return EMPTY_SECTION_CHANGES
        }
    }, [config, committed])

    // The agent commits itself and the playground switches in place; once this control renders the
    // NEW revision we diff it against the captured previous parameters. FROZEN on the first
    // non-empty result so the user's own later edits don't drift into "the agent changed this".
    const commitSignal = useAtomValue(agentSelfCommitSignalAtom)
    const frozenRef = useRef<{signalAt: number; changes: SectionChanges} | null>(null)
    const agent = useMemo(() => {
        if (!commitSignal || !revisionId || commitSignal.revisionId !== revisionId) return null
        if (frozenRef.current?.signalAt === commitSignal.at) return frozenRef.current.changes
        try {
            // local = the NEW config, remote = the PREVIOUS revision's. Order is load-bearing now
            // that we render before→after: reversing it would report every add as a removal.
            const local = templateOf({agent: config})
            const remote = templateOf(commitSignal.prevParameters as Record<string, unknown>)
            if (!local || !remote) return null
            const changes = toSectionChanges(classifyAgentChanges(local, remote))
            if (!changes.panelKeys.size) return null
            frozenRef.current = {signalAt: commitSignal.at, changes}
            return changes
        } catch {
            return null
        }
    }, [commitSignal, revisionId, config])

    const agentVersion = useMemo(() => {
        const raw = commitSignal?.version ? String(commitSignal.version) : null
        return raw ? (raw.startsWith("v") ? raw : `v${raw}`) : null
    }, [commitSignal?.version])

    return {draft, agent, agentVersion, committed}
}
