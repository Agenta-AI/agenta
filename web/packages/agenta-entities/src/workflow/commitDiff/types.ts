/**
 * Semantic commit-diff types for agent/LLM workflows.
 *
 * The classifier turns two `parameters` objects into a small, render-ready set of
 * `ChangeSection`s (tools / instructions / model / params). The commit modal renders
 * these as a plain-language summary; the raw JSON diff stays available separately.
 */
import type {ExtendedDiffLine} from "@agenta/ui/diff"

export type ChangeKind = "added" | "removed" | "edited" | "changed"

export type SectionId = "tools" | "instructions" | "model" | "params" | "mcps" | "skills"

export interface ChangeTag {
    kind: ChangeKind
    /** Short human label, e.g. "24 added", "Edited", "+182 / −37 lines". */
    label: string
}

/** A single field/param change inside an edited tool. */
export interface ToolFieldChange {
    field: string
    kind: ChangeKind
    /** e.g. "description changed", "number, added". */
    detail: string
}

/** A row in a section — a tool, or a labelled entry. */
export interface ChangeItem {
    id: string
    label: string
    detail?: string
    kind: ChangeKind
    /** Original key (e.g. gateway function name) for drill-in / JSON. */
    rawKey?: string
    /** Populated for edited tools so the detail view can show field-level changes. */
    fieldChanges?: ToolFieldChange[]
    /** description before/after for an edited tool. */
    descriptionDiff?: {before: string; after: string}
}

/** A scalar before→after change (model, temperature, …). */
export interface ScalarChange {
    key: string
    before: string | undefined
    after: string | undefined
    kind: ChangeKind
}

/** A text (prose) diff — instructions. */
export interface TextDiff {
    added: number
    removed: number
    before: string
    after: string
    hunks: ExtendedDiffLine[]
}

export interface ChangeSection {
    id: SectionId
    title: string
    tags: ChangeTag[]
    /** Total change count in this section — drives caps / collapse defaults. */
    totalCount: number
    defaultCollapsed?: boolean
    items?: ChangeItem[]
    scalarChanges?: ScalarChange[]
    textDiff?: TextDiff
}

/** Normalized view of an agent's `parameters`, resolved across the 3 schema shapes. */
export interface NormalizedTool {
    /** Canonical, collision-free identity (see `agentItemIdentity`) — the diff map key. */
    key: string
    label: string
    /** Technical name shown in the detail view: function name / reference slug / builtin type. */
    rawKey?: string
    /** e.g. "Gmail" — provider/integration, when derivable from a gateway name. */
    source?: string
    description: string
    /** Stable-stringified `parameters` schema, for equality checks. */
    paramsJson: string
    /** The raw parameters object, for field-level diffing. */
    params: Record<string, unknown>
    /** Stable-stringified whole tool — edit detection across all tool subtypes (incl. nameless). */
    fingerprint: string
    /** A function-call tool (`function.name`); only these get field-level diffs. */
    isFunction: boolean
}

export interface AgentConfigView {
    instructions: string
    tools: NormalizedTool[]
    model: string | undefined
    params: Record<string, unknown>
    /** Raw ModelRef (`{provider, model, connection}`) — feeds the Model & harness section. */
    llm: Record<string, unknown> | undefined
    /** Portable list sections (agent-template). */
    mcps: unknown[]
    skills: unknown[]
    /** Agent-template execution sections (`agent.{harness,runner,sandbox}`), when present. */
    harness: Record<string, unknown> | undefined
    runner: Record<string, unknown> | undefined
    sandbox: Record<string, unknown> | undefined
}
