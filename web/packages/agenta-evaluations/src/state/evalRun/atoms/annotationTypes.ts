/**
 * Local annotation DTO types for the eval-run atom layer.
 *
 * Mirrors `@/oss/lib/hooks/useAnnotations/types` (the OSS source the atoms used before
 * relocation). Defined locally so the package stays free of any `@/oss` import. The
 * eval-run annotation atoms only read these shapes; the OSS layer supplies the runtime
 * transform via `injectedAnnotationTransformAtom`.
 */

interface AnnotationLink {
    trace_id?: string
    span_id?: string
    attributes?: Record<string, unknown>
}

interface AnnotationReference {
    id?: string
    slug?: string
    version?: number
    attributes?: Record<string, unknown>
}

interface AnnotationReferences {
    evaluator: AnnotationReference
    evaluator_revision?: AnnotationReference
    testset?: AnnotationReference
    testcase?: AnnotationReference
}

interface AnnotationMetadata {
    name: string
    description: string
    tags: string[]
}

type AnnotationKind = "adhoc" | "eval"
type AnnotationChannel = "web" | "sdk" | "api"
type AnnotationOrigin = "custom" | "human" | "auto"

type AnnotationLinks = Record<string, AnnotationLink>

// Depth-limited JSON type to prevent TypeScript infinite recursion errors (see TS issue #34933)
type Prev = [never, 0, 1, 2, 3, 4]
export type FullJsonRec<Depth extends number = 4> = Depth extends 0
    ? unknown // base case: stop recursion
    :
          | string
          | number
          | boolean
          | null
          | {[key: string]: FullJsonRec<Prev[Depth]>}
          | FullJsonRec<Prev[Depth]>[]

export type FullJson = FullJsonRec<4>

interface BaseAnnotationDto {
    trace_id?: string
    span_id?: string
    link?: AnnotationLink
    data: {
        outputs?: Record<string, FullJson>
    }
    references?: AnnotationReferences
    links?: AnnotationLinks
    channel?: AnnotationChannel
    kind?: AnnotationKind
    origin?: AnnotationOrigin
    meta?: AnnotationMetadata
}

export interface AnnotationResponseDto extends BaseAnnotationDto {
    created_at?: string
    created_by_id?: string
}

export interface AnnotationDto extends BaseAnnotationDto {
    createdAt?: string
    createdBy?: string
    createdById?: string
    // Added uuid to generate unique id for each annotation in the annotations table
    id?: string
}
