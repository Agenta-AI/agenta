/**
 * Step roles we care about in the evaluation workflow.
 */
export type StepKind = "input" | "invocation" | "annotation"

/** Mapping entry for a single column extracted from a step */
export interface ColumnDef {
    /** Column (human-readable) name e.g. "country" or "outputs" */
    name: string
    /** "input" | "invocation" | "annotation" */
    kind: StepKind
    /** Optional evaluator metric primitive type ("number", "boolean", etc.) */
    metricType?: string
    /** Dot-path used to resolve the value inside the owning step payload / testcase */
    path: string
    /** Key of the step that owns this column */
    stepKey: string
    /** Unique column key used by UI tables */
    key?: string
}

/** Metadata we store per step key */
export interface StepMeta {
    key: string
    kind: StepKind
    /** List of upstream step keys declared in `inputs` */
    upstream: string[]
    /** Raw references blob – may contain application, evaluator, etc. */
    refs: Record<string, any>
}

export interface RunIndex {
    /** Map stepKey -> meta */
    steps: Record<string, StepMeta>
    /** Map stepKey -> array of ColumnDefs */
    columnsByStep: Record<string, ColumnDef[]>
    /** Convenience sets for quick lookup */
    invocationKeys: Set<string>
    annotationKeys: Set<string>
    inputKeys: Set<string>
}

/**
 * Build a ready-to-use index for an evaluation run.
 * Call this **once** right after fetching the raw run and cache the result.
 * The index can then be shared by single-scenario and bulk fetchers.
 */
export function buildRunIndex(rawRun: any): RunIndex {
    const steps: Record<string, StepMeta> = {}
    const columnsByStep: Record<string, ColumnDef[]> = {}

    // Build evaluator slug->key set later
    const evaluatorSlugToId = new Map<string, string>()

    // 1️⃣  Index steps -------------------------------------------------------
    for (const s of rawRun?.data?.steps ?? []) {
        let kind: StepKind = "annotation"
        if (s.references?.testset) {
            kind = "input"
        } else if (s.references?.applicationRevision || s.references?.application) {
            kind = "invocation"
        } else if (s.references?.evaluator) {
            kind = "annotation"
            if (s.references.evaluator.slug) {
                evaluatorSlugToId.set(s.references.evaluator.slug, s.references.evaluator.id)
            }
        }

        steps[s.key] = {
            key: s.key,
            kind,
            upstream: (s.inputs ?? []).map((i: any) => i.key),
            refs: s.references ?? {},
        }
    }

    // 2️⃣  Group column defs by step ---------------------------------------
    for (const m of rawRun?.data?.mappings ?? []) {
        const colKind: StepKind =
            m.column.kind === "testset"
                ? "input"
                : m.column.kind === "invocation"
                  ? "invocation"
                  : "annotation"
        const col: ColumnDef = {
            name: m.column.name,
            kind: colKind,
            path: m.step.path,
            stepKey: m.step.key,
        }
        ;(columnsByStep[col.stepKey] ||= []).push(col)
    }

    // 3️⃣  Precompute key sets by role ----------------------
    const invocationKeys = new Set<string>()
    const annotationKeys = new Set<string>()
    const inputKeys = new Set<string>()

    for (const meta of Object.values(steps)) {
        if (meta.kind === "invocation") invocationKeys.add(meta.key)
        if (meta.kind === "annotation") annotationKeys.add(meta.key)
        if (meta.kind === "input") inputKeys.add(meta.key)
    }

    return {steps, columnsByStep, invocationKeys, annotationKeys, inputKeys}
}

export function serializeRunIndex(idx: RunIndex) {
    return {
        ...idx,
        invocationKeys: [...idx.invocationKeys],
        annotationKeys: [...idx.annotationKeys],
        inputKeys: [...idx.inputKeys],
    }
}

export function deserializeRunIndex(idx: any): RunIndex {
    return {
        ...idx,
        invocationKeys: new Set(idx.invocationKeys),
        annotationKeys: new Set(idx.annotationKeys),
        inputKeys: new Set(idx.inputKeys),
    }
}
