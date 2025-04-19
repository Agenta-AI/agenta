export interface OpenAPISpec {
    paths: Record<string, any>
    components?: {
        schemas?: Record<string, any>
    }
}
