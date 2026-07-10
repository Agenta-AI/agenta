/**
 * Classify the difference between two agent configs into render-ready sections.
 *
 * `remote` is the committed side, `local` the edited side (added = present locally,
 * removed = present remotely). Returns `[]` when nothing recognized changed, so the
 * caller can fall back to the coarse "Configuration modified" + JSON view.
 */
import {computeTextDiffLines} from "@agenta/ui/diff"

import {PARAM_KEYS, readAgentConfig, stableStringify} from "./accessors"
import {agentItemIdentity, type AgentItemKind} from "./identity"
import type {
    AgentConfigView,
    ChangeItem,
    ChangeSection,
    NormalizedTool,
    ScalarChange,
    ToolFieldChange,
} from "./types"

function fmtScalar(v: unknown): string | undefined {
    if (v === undefined || v === null) return undefined
    if (typeof v === "object") return JSON.stringify(v)
    return String(v)
}

function isPlainObj(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Flatten nested config leaves to dot-path keys (arrays kept whole), for scalar diffing. */
function flattenScalars(
    obj: Record<string, unknown>,
    prefix = "",
    out: Record<string, unknown> = {},
): Record<string, unknown> {
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k
        if (isPlainObj(v)) flattenScalars(v, key, out)
        else out[key] = v
    }
    return out
}

function toolProps(tool: NormalizedTool): Record<string, unknown> {
    const props = tool.params?.properties
    return typeof props === "object" && props !== null && !Array.isArray(props)
        ? (props as Record<string, unknown>)
        : {}
}

function diffToolFields(before: NormalizedTool, after: NormalizedTool): ToolFieldChange[] {
    const changes: ToolFieldChange[] = []
    if (before.description !== after.description) {
        changes.push({field: "description", kind: "changed", detail: "description changed"})
    }
    const b = toolProps(before)
    const a = toolProps(after)
    const keys = new Set([...Object.keys(b), ...Object.keys(a)])
    for (const key of keys) {
        const inB = key in b
        const inA = key in a
        if (inA && !inB) {
            const type =
                typeof (a[key] as Record<string, unknown>)?.type === "string"
                    ? `${(a[key] as Record<string, unknown>).type}, added`
                    : "added"
            changes.push({field: key, kind: "added", detail: type})
        } else if (inB && !inA) {
            changes.push({field: key, kind: "removed", detail: "removed"})
        } else if (stableStringify(b[key]) !== stableStringify(a[key])) {
            changes.push({field: key, kind: "changed", detail: "changed"})
        }
    }
    return changes
}

function toolRowDetail(fields: ToolFieldChange[]): string | undefined {
    const descChanged = fields.some((f) => f.field === "description")
    const paramCount = fields.filter((f) => f.field !== "description").length
    const parts: string[] = []
    if (descChanged) parts.push("description")
    if (paramCount) parts.push(paramCount === 1 ? "1 parameter" : `${paramCount} parameters`)
    // Fingerprint-based edit detection can flag a change in a field diffToolFields doesn't inspect
    // (or a nameless reference/builtin tool with no fields) — fall back to a generic label so the
    // "edited" badge is never left unexplained.
    if (!parts.length) return "changed"
    return `${parts.join(" & ")} changed`
}

function toolsSection(local: AgentConfigView, remote: AgentConfigView): ChangeSection | null {
    const localMap = new Map(local.tools.map((t) => [t.key, t]))
    const remoteMap = new Map(remote.tools.map((t) => [t.key, t]))

    const added: NormalizedTool[] = []
    const removed: NormalizedTool[] = []
    const edited: {tool: NormalizedTool; fields: ToolFieldChange[]}[] = []

    for (const [key, tool] of localMap) {
        const prev = remoteMap.get(key)
        if (!prev) {
            added.push(tool)
        } else if (prev.fingerprint !== tool.fingerprint) {
            // Field-level detail only for function tools; reference/builtin edits register with the
            // generic "changed" detail (they have no function fields to itemize).
            edited.push({tool, fields: tool.isFunction ? diffToolFields(prev, tool) : []})
        }
    }
    for (const [key, tool] of remoteMap) {
        if (!localMap.has(key)) removed.push(tool)
    }

    const total = added.length + removed.length + edited.length
    if (total === 0) return null

    const items = [
        ...added.map((t) => ({
            id: t.key,
            label: t.label,
            detail: t.source,
            kind: "added" as const,
            rawKey: t.rawKey,
        })),
        ...edited.map(({tool, fields}) => ({
            id: tool.key,
            label: tool.label,
            detail: toolRowDetail(fields),
            kind: "edited" as const,
            rawKey: tool.rawKey,
            fieldChanges: fields,
            descriptionDiff: fields.some((f) => f.field === "description")
                ? {
                      before: remoteMap.get(tool.key)?.description ?? "",
                      after: tool.description,
                  }
                : undefined,
        })),
        ...removed.map((t) => ({
            id: t.key,
            label: t.label,
            detail: t.source,
            kind: "removed" as const,
            rawKey: t.rawKey,
        })),
    ]

    const tags = []
    if (added.length) tags.push({kind: "added" as const, label: `${added.length} added`})
    if (edited.length) tags.push({kind: "edited" as const, label: `${edited.length} edited`})
    if (removed.length) tags.push({kind: "removed" as const, label: `${removed.length} removed`})

    return {
        id: "tools",
        title: "Tools",
        tags,
        totalCount: total,
        defaultCollapsed: total > 20,
        items,
    }
}

function instructionsSection(
    local: AgentConfigView,
    remote: AgentConfigView,
): ChangeSection | null {
    if (local.instructions === remote.instructions) return null
    const hunks = computeTextDiffLines(remote.instructions, local.instructions, {
        enableFolding: true,
    })
    let added = 0
    let removed = 0
    for (const line of hunks) {
        if (line.type === "added") added++
        else if (line.type === "removed") removed++
    }
    const label = added + removed <= 2 ? "Edited" : `+${added} / −${removed}`
    return {
        id: "instructions",
        title: "Instructions",
        tags: [{kind: "edited", label}],
        totalCount: 1,
        textDiff: {added, removed, before: remote.instructions, after: local.instructions, hunks},
    }
}

/** Diff two already-flattened scalar maps into a section. Null when nothing changed. */
function scalarSection(
    id: ChangeSection["id"],
    title: string,
    localMap: Record<string, unknown>,
    remoteMap: Record<string, unknown>,
): ChangeSection | null {
    const changes: ScalarChange[] = []
    for (const key of [...new Set([...Object.keys(remoteMap), ...Object.keys(localMap)])].sort()) {
        if (stableStringify(remoteMap[key]) === stableStringify(localMap[key])) continue
        changes.push({
            key,
            before: fmtScalar(remoteMap[key]),
            after: fmtScalar(localMap[key]),
            kind: !(key in remoteMap) ? "added" : !(key in localMap) ? "removed" : "changed",
        })
    }
    if (!changes.length) return null
    return {
        id,
        title,
        tags: [{kind: "changed", label: `${changes.length} changed`}],
        totalCount: changes.length,
        defaultCollapsed: changes.length > 12,
        scalarChanges: changes,
    }
}

/** Prefix every leaf of a flattened section (e.g. `runner.` -> `runner.permissions.default`). */
function prefixed(
    prefix: string,
    obj: Record<string, unknown> | undefined,
): Record<string, unknown> {
    if (!isPlainObj(obj)) return {}
    const flat = flattenScalars(obj)
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(flat)) out[`${prefix}.${k}`] = v
    return out
}

/**
 * Model & harness — the model identity (`llm.model`), all of `llm` (provider + connection/auth),
 * and the harness engine (`harness.kind`), mirroring the config panel's "Model & harness" control
 * section, which now owns connection-mode UI too.
 */
function modelHarnessBucket(v: AgentConfigView): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (v.model !== undefined) out["llm.model"] = v.model
    Object.assign(out, prefixed("llm", v.llm))
    if (isPlainObj(v.harness) && "kind" in v.harness) out["harness.kind"] = v.harness.kind
    return out
}

/**
 * Advanced — everything the config panel *artificially groups* under "Advanced", which lives in
 * several JSON locations: generation params, the runner/sandbox execution sections, and the
 * harness's non-`kind` knobs (e.g. permissions). `llm` in full belongs to Model & harness.
 */
function advancedBucket(v: AgentConfigView): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const key of PARAM_KEYS) if (v.params[key] !== undefined) out[key] = v.params[key]
    Object.assign(out, prefixed("runner", v.runner))
    Object.assign(out, prefixed("sandbox", v.sandbox))
    if (isPlainObj(v.harness)) {
        const {kind: _kind, ...rest} = v.harness
        Object.assign(out, prefixed("harness", rest))
    }
    return out
}

/** Humanize a list entry (mcp/skill) for its summary row. */
function entryLabel(entry: unknown): string {
    if (!isPlainObj(entry)) return "item"
    if (typeof entry.name === "string" && entry.name) return entry.name
    if (typeof entry.slug === "string" && entry.slug) return entry.slug
    const embed = isPlainObj(entry["@ag.embed"]) ? entry["@ag.embed"] : undefined
    const refs = embed && isPlainObj(embed["@ag.references"]) ? embed["@ag.references"] : undefined
    const wf = refs && isPlainObj(refs.workflow) ? refs.workflow : undefined
    if (wf && typeof wf.slug === "string") return wf.slug
    return "item"
}

/**
 * Identity list-diff for portable sections (`mcps`/`skills`). Matching is keyed by the canonical
 * {@link agentItemIdentity} (collision-free), while the row's display label comes from
 * {@link entryLabel} — so two id-less entries never collapse the way a shared label would.
 */
function listSection(
    id: "mcps" | "skills",
    title: string,
    local: unknown[],
    remote: unknown[],
): ChangeSection | null {
    const kind: AgentItemKind = id === "mcps" ? "mcp" : "skill"
    const lMap = new Map(local.map((e, i) => [agentItemIdentity(kind, e, i), e] as const))
    const rMap = new Map(remote.map((e, i) => [agentItemIdentity(kind, e, i), e] as const))
    const added: [string, unknown][] = []
    const removed: [string, unknown][] = []
    const edited: [string, unknown][] = []
    for (const [key, entry] of lMap) {
        const prev = rMap.get(key)
        if (prev === undefined) added.push([key, entry])
        else if (stableStringify(prev) !== stableStringify(entry)) edited.push([key, entry])
    }
    for (const [key, entry] of rMap) if (!lMap.has(key)) removed.push([key, entry])

    const total = added.length + removed.length + edited.length
    if (total === 0) return null

    const rows = (pairs: [string, unknown][], kindTag: ChangeItem["kind"]) =>
        pairs.map(([key, entry]) => ({id: key, label: entryLabel(entry), kind: kindTag}))
    const items = [...rows(added, "added"), ...rows(edited, "edited"), ...rows(removed, "removed")]
    const tags = []
    if (added.length) tags.push({kind: "added" as const, label: `${added.length} added`})
    if (edited.length) tags.push({kind: "edited" as const, label: `${edited.length} edited`})
    if (removed.length) tags.push({kind: "removed" as const, label: `${removed.length} removed`})

    return {id, title, tags, totalCount: total, defaultCollapsed: total > 20, items}
}

export function classifyAgentChanges(localParams: unknown, remoteParams: unknown): ChangeSection[] {
    const local = readAgentConfig(localParams)
    const remote = readAgentConfig(remoteParams)
    // Grouped to mirror the agent-template control sections (Model & harness, Instructions,
    // Tools, MCP servers, Skills, Advanced) so nothing changed is dropped or split.
    return [
        scalarSection(
            "model",
            "Model & harness",
            modelHarnessBucket(local),
            modelHarnessBucket(remote),
        ),
        instructionsSection(local, remote),
        toolsSection(local, remote),
        listSection("mcps", "MCPs", local.mcps, remote.mcps),
        listSection("skills", "Skills", local.skills, remote.skills),
        scalarSection("params", "Advanced", advancedBucket(local), advancedBucket(remote)),
    ].filter((s): s is ChangeSection => s !== null)
}
