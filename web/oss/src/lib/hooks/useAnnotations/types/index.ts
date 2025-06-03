interface AnnotationLink {
    trace_id?: string
    span_id?: string
    attributes?: Record<string, any>
}

interface AnnotationReference {
    id?: string
    slug?: string
    version?: number
    attributes?: Record<string, any>
}

interface AnnotationReferences {
    evaluator: AnnotationReference
    testset?: AnnotationReference
    testcase?: AnnotationReference
}

interface AnnotationMetadata {
    name: string
    description: string
    tags: string[]
}

type AnnotationKind = "custom" | "human" | "auto"

type AnnotationSource = "web" | "sdk" | "api"

type AnnotationLinks = Record<string, AnnotationLink>
type FullJson = string | number | boolean | null | {[key: string]: FullJson} | FullJson[]

interface BaseAnnotationDto {
    trace_id?: string
    span_id?: string
    link?: AnnotationLink
    data: {
        outputs?: Record<string, FullJson>
    }
    references?: AnnotationReferences
    links?: AnnotationLinks
    source?: AnnotationSource
    kind?: AnnotationKind
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

export interface AnnotationEditPayloadDto {
    annotation: {
        data: {
            outputs?: Record<string, any>
        }
        meta: AnnotationMetadata
    }
    trace_id?: string
    span_id?: string
}

export interface AnnotationsResponse {
    count: number
    annotations: AnnotationDto[]
}
