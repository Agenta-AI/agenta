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
import {scalarKeyLabel, scalarValueLabel} from "./scalarLabels"
import type {
    AgentConfigView,
    ChangeItem,
    ChangeSection,
    NormalizedTool,
    ScalarChange,
    TextDiff,
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

/**
 * Diff one slice of the `tools` array. Subagents live in that same array but get their own
 * section, mirroring the config panel — a `{type:"reference"}` entry is another agent, not a tool.
 */
function toolsSection(
    id: "tools" | "subagents",
    title: string,
    noun: string,
    localTools: NormalizedTool[],
    remoteTools: NormalizedTool[],
): ChangeSection | null {
    const localMap = new Map(localTools.map((t) => [t.key, t]))
    const remoteMap = new Map(remoteTools.map((t) => [t.key, t]))

    const added: NormalizedTool[] = []
    const removed: NormalizedTool[] = []
    const edited: {tool: NormalizedTool; fields: ToolFieldChange[]}[] = []

    for (const [key, tool] of localMap) {
        const prev = remoteMap.get(key)
        if (!prev) {
            added.push(tool)
        } else if (prev.fingerprint !== tool.fingerprint) {
            // Every tool kind: a subagent has no params, but its description still diffs.
            edited.push({tool, fields: diffToolFields(prev, tool)})
        }
    }
    for (const [key, tool] of remoteMap) {
        if (!localMap.has(key)) removed.push(tool)
    }

    const total = added.length + removed.length + edited.length
    if (total === 0) return null

    // Inside Subagents the source ("Subagent") only repeats the header.
    const sourceDetail = (t: NormalizedTool) => (id === "subagents" ? undefined : t.source)
    const items = [
        ...added.map((t) => ({
            id: t.key,
            label: t.label,
            detail: sourceDetail(t),
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
            detail: sourceDetail(t),
            kind: "removed" as const,
            rawKey: t.rawKey,
        })),
    ]

    const tags = []
    if (added.length) tags.push({kind: "added" as const, label: `${added.length} added`})
    if (edited.length) tags.push({kind: "edited" as const, label: `${edited.length} edited`})
    if (removed.length) tags.push({kind: "removed" as const, label: `${removed.length} removed`})

    return {
        id,
        title,
        noun,
        tags,
        totalCount: total,
        defaultCollapsed: total > 20,
        items,
    }
}

/** Folded prose diff plus its line counts — the shape both Instructions and skills render. */
function buildTextDiff(before: string, after: string): TextDiff {
    const hunks = computeTextDiffLines(before, after, {enableFolding: true})
    let added = 0
    let removed = 0
    for (const line of hunks) {
        if (line.type === "added") added++
        else if (line.type === "removed") removed++
    }
    return {added, removed, before, after, hunks}
}

function instructionsSection(
    local: AgentConfigView,
    remote: AgentConfigView,
): ChangeSection | null {
    if (local.instructions === remote.instructions) return null
    const textDiff = buildTextDiff(remote.instructions, local.instructions)
    const total = textDiff.added + textDiff.removed
    return {
        id: "instructions",
        title: "Instructions",
        tags: [
            {
                kind: "edited",
                label: total <= 2 ? "Edited" : `+${textDiff.added} / −${textDiff.removed}`,
            },
        ],
        totalCount: 1,
        textDiff,
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
        const before = fmtScalar(remoteMap[key])
        const after = fmtScalar(localMap[key])
        changes.push({
            key,
            label: scalarKeyLabel(key),
            // Stored values stay untouched: the config panel reads them back to say what a
            // property was committed as, and a display string there would be a lie.
            before,
            after,
            beforeLabel: scalarValueLabel(key, before, remoteMap[key]),
            afterLabel: scalarValueLabel(key, after, localMap[key]),
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
 * Model — the model identity (`llm.model`), all of `llm` (provider + connection/auth), and the
 * harness engine (`harness.kind`), mirroring the config panel's "Model" section, which owns the
 * harness and connection-mode UI too.
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
 * harness's non-`kind` knobs (e.g. permissions). `llm` in full belongs to Model.
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

const entryField = (entry: unknown, field: string): string => {
    if (!isPlainObj(entry)) return ""
    const value = entry[field]
    return typeof value === "string" ? value : ""
}

/**
 * What an edited list entry changed. A skill carries prose — its SKILL.md `body` — so it gets the
 * same hunk view Instructions does rather than a bare "edited" mark.
 */
function entryEdit(before: unknown, after: unknown): Pick<ChangeItem, "detail" | "textDiff"> {
    const parts: string[] = []
    if (entryField(before, "name") !== entryField(after, "name")) parts.push("name")
    if (entryField(before, "description") !== entryField(after, "description")) {
        parts.push("description")
    }
    const beforeBody = entryField(before, "body")
    const afterBody = entryField(after, "body")
    const bodyChanged = beforeBody !== afterBody
    if (bodyChanged) parts.push("instructions")
    return {
        detail: parts.length ? `${parts.join(" & ")} changed` : undefined,
        textDiff: bodyChanged ? buildTextDiff(beforeBody, afterBody) : undefined,
    }
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
interface ListEntry {
    key: string
    entry: unknown
    index: number
}

function listSection(
    id: "mcps" | "skills",
    title: string,
    local: unknown[],
    remote: unknown[],
): ChangeSection | null {
    const kind: AgentItemKind = id === "mcps" ? "mcp" : "skill"
    const read = (list: unknown[]): ListEntry[] =>
        list.map((entry, index) => ({key: agentItemIdentity(kind, entry, index), entry, index}))
    const lEntries = read(local)
    const rEntries = read(remote)
    const lMap = new Map(lEntries.map((e) => [e.key, e]))
    const rMap = new Map(rEntries.map((e) => [e.key, e]))

    const added: ListEntry[] = []
    const removed: ListEntry[] = []
    const edited: {key: string; before: unknown; after: unknown}[] = []
    for (const entry of lEntries) {
        const prev = rMap.get(entry.key)
        if (!prev) added.push(entry)
        else if (stableStringify(prev.entry) !== stableStringify(entry.entry)) {
            edited.push({key: entry.key, before: prev.entry, after: entry.entry})
        }
    }
    for (const entry of rEntries) if (!lMap.has(entry.key)) removed.push(entry)

    // Identity is the name, so renaming an entry in place would read as a removal plus an
    // unrelated addition — and the body diff behind it would never be computed. Pair whatever is
    // left over by the slot it occupies before concluding they are different entries.
    for (let i = added.length - 1; i >= 0; i -= 1) {
        const match = removed.findIndex((r) => r.index === added[i].index)
        if (match === -1) continue
        edited.push({key: added[i].key, before: removed[match].entry, after: added[i].entry})
        removed.splice(match, 1)
        added.splice(i, 1)
    }

    const total = added.length + removed.length + edited.length
    if (total === 0) return null

    const plain = (entries: ListEntry[], kindTag: ChangeItem["kind"]) =>
        entries.map(({key, entry}) => ({id: key, label: entryLabel(entry), kind: kindTag}))
    const editedRows = edited.map(({key, before, after}) => {
        const beforeLabel = entryLabel(before)
        const afterLabel = entryLabel(after)
        return {
            id: key,
            // A rename is only legible as both names; one of them alone hides what happened.
            label: beforeLabel === afterLabel ? afterLabel : `${beforeLabel} → ${afterLabel}`,
            kind: "edited" as const,
            ...entryEdit(before, after),
        }
    })
    const items = [...plain(added, "added"), ...editedRows, ...plain(removed, "removed")]
    const tags = []
    if (added.length) tags.push({kind: "added" as const, label: `${added.length} added`})
    if (edited.length) tags.push({kind: "edited" as const, label: `${edited.length} edited`})
    if (removed.length) tags.push({kind: "removed" as const, label: `${removed.length} removed`})

    return {id, title, tags, totalCount: total, defaultCollapsed: total > 20, items}
}

/** Subagents share the `tools` array with real tools; each section sees only its own kind. */
const tools = (v: AgentConfigView) => v.tools.filter((t) => !t.isSubagent)
const subagents = (v: AgentConfigView) => v.tools.filter((t) => t.isSubagent)

export function classifyAgentChanges(localParams: unknown, remoteParams: unknown): ChangeSection[] {
    const local = readAgentConfig(localParams)
    const remote = readAgentConfig(remoteParams)
    // The agent panel calls them Integrations; the prompt playground has plain tools.
    const asAgent = local.isAgentTemplate || remote.isAgentTemplate
    const [toolsTitle, toolsNoun] = asAgent ? ["Integrations", "integration"] : ["Tools", "tool"]
    // Grouped to mirror the agent-template control sections (Model, Instructions,
    // Tools, Subagents, MCP servers, Skills, Advanced) so nothing changed is dropped or split.
    return [
        scalarSection("model", "Model", modelHarnessBucket(local), modelHarnessBucket(remote)),
        instructionsSection(local, remote),
        toolsSection("tools", toolsTitle, toolsNoun, tools(local), tools(remote)),
        toolsSection("subagents", "Subagents", "subagent", subagents(local), subagents(remote)),
        listSection("mcps", "MCPs", local.mcps, remote.mcps),
        listSection("skills", "Skills", local.skills, remote.skills),
        scalarSection("params", "Advanced", advancedBucket(local), advancedBucket(remote)),
    ].filter((s): s is ChangeSection => s !== null)
}
