export interface _AgentaRootsResponse extends AgentaNodeDTO {
    children: _AgentaRootsResponse[]
    key: string
}

export interface AgentaRootsResponse {
    version: string
    roots: AgentaRootsDTO[]
}

export interface AgentaRootsDTO {
    root: RootContextDTO
    trees: AgentaTreeDTO[]
}

interface RootContextDTO {
    id: string
}

export interface AgentaTreeDTO {
    tree: TreeContextDTO
    nodes: AgentaNodeDTO[]
}

enum NodeTreeType {
    INVOCATION = "invocation",
}

interface TreeContextDTO {
    id: string
    type?: NodeTreeType | null
}
export interface AgentaNodeDTO {
    lifecycle?: NodeLifecycleDTO | null
    time: NodeTimeDTO
    status: NodeStatusDTO
    exception?: NodeExceptionDTO | null
    data?: NodeData | null
    metrics?: NodeMetrics | null
    meta?: NodeMetadata | null
    refs?: NodeRefs | null
    root: RootContextDTO
    tree: TreeContextDTO
    node: NodeContextDTO
    parent?: ParentContextDTO | null
    links?: NodeLinkDTO[] | null
    otel?: NodeOTelExtraDTO | null
    nodes?: Record<string, AgentaNodeDTO | AgentaNodeDTO[]> | null
}

type NodeData = Record<string, any>
type NodeMetrics = Record<string, any>
type NodeMetadata = Record<string, any>
type NodeRefs = Record<string, any>
type NodeLinkDTO = {
    type: string
    id: string
}
interface NodeExceptionDTO {
    timestamp: string
    type: string
    message?: string | null
    stacktrace?: string | null
    attributes?: Record<string, any> | null
}
type NodeOTelExtraDTO = {
    kind?: string | null
    attributes?: Record<string, any> | null
    events?: NodeOTelEventDTO[] | null
    links?: NodeOTelLinkDTO[] | null
}

type NodeOTelEventDTO = {
    name: string
    timestamp: string
    attributes?: Record<string, any> | null
}

type NodeOTelLinkDTO = {
    context: {
        trace_id: string
        span_id: string
    }
    attributes?: Record<string, any> | null
}

interface NodeLifecycleDTO {
    created_at: string
    updated_at?: string | null
    updated_by_id?: string | null
}

interface NodeContextDTO {
    id: string
    type?: NodeType | null
    name: string
}

export enum NodeType {
    AGENT = "agent",
    WORKFLOW = "workflow",
    CHAIN = "chain",
    TASK = "task",
    TOOL = "tool",
    EMBEDDING = "embedding",
    QUERY = "query",
    COMPLETION = "completion",
    CHAT = "chat",
    RERANK = "rerank",
}

export enum NodeStatusCode {
    UNSET = "UNSET",
    OK = "OK",
    ERROR = "ERROR",
}

interface ParentContextDTO {
    id: string
}

interface NodeTimeDTO {
    start: string
    end: string
    span?: number
}

export interface NodeStatusDTO {
    code: NodeStatusCode
    message?: string | null
}
