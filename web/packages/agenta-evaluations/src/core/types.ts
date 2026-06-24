import type {OpenAPISpec} from "@agenta/entities/shared/openapi"
import type {Workflow} from "@agenta/entities/workflow"

/**
 * Minimal testset shape `buildRunConfig` reads. The OSS caller passes its richer
 * testset object; only these fields are consumed here.
 */
export interface RunConfigTestset {
    id: string
    name?: string | null
    slug?: string | null
    revisionId?: string
    variantId?: string
    /** Legacy CSV rows — first row's keys become columns. */
    csvdata?: Record<string, unknown>[]
    /** Newer testset payload — `data.testcases[].data` or `data.columns`. */
    data?: {
        testcases?: (Record<string, unknown> | {data?: Record<string, unknown>})[]
        columns?: string[]
        columnNames?: string[]
        [key: string]: unknown
    }
}

/**
 * Per-revision schema context, resolved by the CALLER (the OSS `-ui` provider reads
 * the playground/workflow jotai atoms and passes plain data in). This is the seam
 * that keeps `@agenta/evaluations` free of any jotai / playground / getDefaultStore
 * imports — the package receives resolved schemas, never atom references.
 *
 * Sourced in OSS from, per `revision.id`:
 *   - isCustom              ← currentAppContextAtom.appType === "custom"
 *   - spec                  ← appOpenApiSchemaAtomFamily(revisionId)
 *   - routePath             ← appRoutePathAtomFamily(revisionId)
 *   - inputSchemaProperties ← workflowMolecule.selectors.inputSchema(revisionId).properties
 */
export interface RevisionSchemaContext {
    isCustom: boolean
    /** Resolved OpenAPI spec object for the revision (or null if unavailable). */
    spec: OpenAPISpec | null
    routePath: string
    /** `properties` of the workflow input schema, used for non-custom variable names. */
    inputSchemaProperties: Record<string, unknown> | null
}

export interface BuildRunConfigInput {
    name: string
    testset?: RunConfigTestset
    revisions: Workflow[]
    evaluators?: Workflow[]
    correctAnswerColumn: string
    meta?: Record<string, unknown>
    /** Caller-resolved schema context keyed by `revision.id`. */
    schemaContextByRevisionId: Record<string, RevisionSchemaContext>
}

export type RunStepType = "input" | "invocation" | "annotation"
export type RunStepOrigin = "auto" | "human"

export interface RunStep {
    key: string
    type: RunStepType
    origin: RunStepOrigin
    references: Record<string, {id: string}>
    inputs?: {key: string}[]
}

export interface RunMapping {
    column: {kind: "testset" | "invocation" | "evaluator"; name: string}
    step: {key: string; path: string}
}

export interface RunConfig {
    key: string
    name: string
    meta?: Record<string, unknown>
    data: {steps: RunStep[]; mappings: RunMapping[]}
}

export interface BuildRunConfigResult {
    runs: RunConfig[]
}
