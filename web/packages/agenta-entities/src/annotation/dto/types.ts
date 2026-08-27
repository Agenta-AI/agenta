/**
 * DTO-shaped annotation types.
 *
 * These describe the raw `simple/traces` payloads the observability and drawer
 * surfaces consume. They are intentionally separate from the zod-validated
 * `Annotation` entity in `../core` — that one is the molecule's shape, this one
 * is the wire shape those surfaces still read directly.
 */

export interface AnnotationLinkDto {
    trace_id?: string
    span_id?: string
    attributes?: Record<string, unknown>
}

export interface AnnotationReferenceDto {
    id?: string
    slug?: string
    version?: number
    attributes?: Record<string, unknown>
}

export interface AnnotationReferencesDto {
    evaluator: AnnotationReferenceDto
    evaluator_revision?: AnnotationReferenceDto
    testset?: AnnotationReferenceDto
    testcase?: AnnotationReferenceDto
}

export interface AnnotationMetadataDto {
    name: string
    description: string
    tags: string[]
}

type AnnotationKindDto = "adhoc" | "eval"
type AnnotationChannelDto = "web" | "sdk" | "api"
type AnnotationOriginDto = "custom" | "human" | "auto"

type AnnotationLinksDto = Record<string, AnnotationLinkDto>

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
    link?: AnnotationLinkDto
    data: {
        outputs?: Record<string, FullJson>
    }
    references?: AnnotationReferencesDto
    links?: AnnotationLinksDto
    channel?: AnnotationChannelDto
    kind?: AnnotationKindDto
    origin?: AnnotationOriginDto
    meta?: AnnotationMetadataDto
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

export interface AnnotationEditPayloadDto {
    annotation: {
        data: {
            outputs?: Record<string, unknown>
        }
        meta: AnnotationMetadataDto
    }
    trace_id?: string
    span_id?: string
}

/** Named `…Dto` to avoid colliding with `AnnotationsResponse` from `../core`. */
export interface AnnotationsResponseDto {
    count: number
    annotation: AnnotationDto
    annotations: AnnotationDto[]
}
