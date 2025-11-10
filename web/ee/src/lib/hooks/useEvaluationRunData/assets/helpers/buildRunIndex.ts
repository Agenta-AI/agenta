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
    /** Optional marker for where the column originated (auto/custom/human/etc.) */
    origin?: string
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
    origin?: string
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
    const shouldLog =
        process.env.NODE_ENV !== "production" &&
        typeof window !== "undefined" &&
        (rawRun?.evaluation_type === "online" ||
            rawRun?.data?.evaluation_type === "online" ||
            rawRun?.meta?.evaluation_type === "online")

    for (const s of rawRun?.data?.steps ?? []) {
        let kind: StepKind = "annotation"
        const refs = s.references ?? {}
        const hasInvocationReference =
            Boolean(refs.applicationRevision) ||
            Boolean(refs.application) ||
            Boolean(refs.query) ||
            Boolean(refs.query_revision) ||
            Boolean(refs.queryRevision) ||
            Boolean(refs.query_variant) ||
            Boolean(refs.queryVariant)
        if (refs.testset) {
            kind = "input"
        } else if (refs.evaluator) {
            kind = "annotation"
            if (refs.evaluator.slug) {
                evaluatorSlugToId.set(refs.evaluator.slug, refs.evaluator.id)
            }
        } else if (hasInvocationReference) {
            kind = "invocation"
        }

        if (shouldLog) {
            console.debug("[EvalRun][buildRunIndex] Step classified", {
                key: s.key,
                refs: Object.keys(refs || {}),
                kind,
            })
        }

        steps[s.key] = {
            key: s.key,
            kind,
            origin: typeof s.origin === "string" ? s.origin : undefined,
            upstream: (s.inputs ?? []).map((i: any) => i.key),
            refs: s.references ?? {},
        }
    }

    // 2️⃣  Group column defs by step ---------------------------------------
    for (const m of rawRun?.data?.mappings ?? []) {
        const stepKind = steps[m.step.key]?.kind
        const rawKind = typeof m.column.kind === "string" ? m.column.kind.toLowerCase() : ""
        const colKind: StepKind =
            stepKind ||
            (rawKind === "testset" || rawKind.includes("testset") || rawKind.includes("input")
                ? "input"
                : rawKind === "invocation" ||
                    rawKind.includes("invocation") ||
                    rawKind.includes("application") ||
                    rawKind.includes("query")
                  ? "invocation"
                  : "annotation")

        if (shouldLog) {
            console.debug("[EvalRun][buildRunIndex] Column mapping", {
                column: m.column?.name,
                rawKind: m.column?.kind,
                resolvedKind: colKind,
                stepKey: m.step?.key,
            })
        }

        const metaForStep = steps[m.step.key]
        const col: ColumnDef = {
            name: m.column.name,
            kind: colKind,
            origin: metaForStep?.origin,
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
