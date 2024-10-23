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

interface TreeContextDTO {
    id: string
}

export interface AgentaNodeDTO extends NodeDTO {}

export interface NodeDTO {
    scope: ProjectScopeDTO
    lifecycle: NodeLifecycleDTO
    root: RootContextDTO
    tree: TreeContextDTO
    node: NodeContextDTO
    parent?: ParentContextDTO | null
    time: NodeTimeDTO
    status: NodeStatusDTO
    data?: NodeData | null
    metrics?: NodeMetrics | null
    meta?: NodeMetadata | null
    tags?: NodeTags | null
    refs?: NodeRefs | null
    links?: NodeLinkDTO[] | null
    nodes?: Record<string, NodeDTO | NodeDTO[]> | null
    exception?: NodeExceptionDTO | null
}

type NodeData = Record<string, any>
type NodeMetrics = Record<string, any>
type NodeMetadata = Record<string, any>
type NodeTags = Record<string, string>
type NodeRefs = Record<string, string>
type NodeLinkDTO = {
    type: string
    id: string
    tree_id?: string | null
}
interface NodeExceptionDTO {
    timestamp: string
    type: string
    message?: string | null
    stacktrace?: string | null
    attributes?: Record<string, any> | null
}

interface ProjectScopeDTO {
    project_id: string
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
    span: number
}

export interface NodeStatusDTO {
    code: NodeStatusCode
    message?: string | null
}
