interface AnnotationLink {
    trace_id?: string
    span_id?: string
    attributes?: Record<string, any>
}

type AnnotationReference = {
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

type AnnotationKind = "custom" | "human" | "auto"

type AnnotationSource = "web" | "sdk" | "api"

type AnnotationLinks = Record<string, AnnotationLink>
type FullJson = string | number | boolean | null | {[key: string]: FullJson} | FullJson[]

export interface AnnotationDto {
    trace_id?: string
    span_id?: string
    link?: AnnotationLink
    data: {
        outputs?: {[key: string]: FullJson}
    }
    references?: AnnotationReferences
    links?: AnnotationLinks
    source?: AnnotationSource
    kind?: AnnotationKind
    created_at?: string
    created_by_id?: string
    // Added uuid to generate unique id for each annotation in the annotations table
    id?: string
}

export interface AnnotationsResponse {
    count: number
    annotations: AnnotationDto[]
}
