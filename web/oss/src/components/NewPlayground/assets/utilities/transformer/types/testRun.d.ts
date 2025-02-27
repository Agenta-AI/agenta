/** API Response types for test runs */
interface ExecutionMetrics {
    duration: {total: number}
    costs: {total: number}
    tokens: {
        prompt: number
        completion: number
        total: number
    }
}

interface ExecutionNode {
    lifecycle: {
        created_at: string
        updated_at: string | null
        updated_by_id: string | null
        updated_by: string | null
    }
    root: {id: string}
    tree: {id: string; type: string | null}
    node: {id: string; name: string; type: string}
    parent: {id: string} | null
    time: {start: string; end: string}
    status: {code: string; message: string | null}
    exception: unknown | null
    data: {
        inputs: Record<string, unknown>
        outputs: string | Record<string, unknown>
    }
    metrics: {
        acc: ExecutionMetrics
        unit?: ExecutionMetrics
    }
    meta: {
        configuration: Record<string, unknown>
    }
    refs: unknown | null
    links: unknown | null
    otel: {
        kind: string
        attributes: unknown | null
        events: unknown[]
        links: unknown | null
    }
    nodes: Record<string, ExecutionNode> | null
}

interface ExecutionTree {
    nodes: ExecutionNode[]
    version: string
    count: number | null
}

interface ApiResponse {
    version: string
    data: string
    content_type: string
    tree: ExecutionTree
}

/** Result structure for test runs */
export interface TestResult {
    response?: ApiResponse
    error?: string
    metadata?: Record<string, unknown>
}
