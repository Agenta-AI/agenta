export interface Query {
    id: string
    name?: string
    description?: string
    slug?: string
    flags?: string[]
    tags?: string[]
    meta?: Record<string, any> | null
    archived?: boolean
    created_at?: string
    updated_at?: string
}

export interface QueryResponse {
    count: number
    query?: Query | null
}

export interface QueriesResponse {
    count: number
    queries: Query[]
}

export interface QueryCreateRequest {
    query: Partial<Query> & {id?: string}
}

export interface QueryEditRequest {
    query: Query
}

export interface QueryRef {
    id?: string
    slug?: string
}

export interface QueryQueryRequest {
    query?: Partial<Query>
    query_refs?: QueryRef[]
    include_archived?: boolean
    windowing?: any
}
