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

interface AgentaTreeDTO {
    tree: TreeContextDTO
    nodes: Record<string, AgentaNodeDTO>
}

interface TreeContextDTO {
    id: string
}

interface AgentaNodeDTO extends NodeDTO {}

interface NodeDTO {
    scope: ProjectScopeDTO
    lifecycle: LifecycleDTO
    root: RootContextDTO
    tree: TreeContextDTO
    node: NodeContextDTO
    parent?: ParentContextDTO | null
    time: TimeDTO
    status: StatusDTO
    data?: Data | null
    metrics?: Metrics | null
    meta?: Metadata | null
    tags?: Tags | null
    refs?: Refs | null
    links?: LinkDTO[] | null
    nodes?: Record<string, NodeDTO | NodeDTO[]> | null
}

type Data = Record<string, any>
type Metrics = Record<string, any>
type Metadata = Record<string, any>
type Tags = Record<string, string>
type Refs = Record<string, string>
type LinkDTO = {
    type: string
    id: string
    tree_id?: string | null
}

interface ProjectScopeDTO {
    project_id: string
}

interface LifecycleDTO {
    created_at: string
    updated_at?: string | null
    updated_by_id?: string | null
}

interface NodeContextDTO {
    id: string
    type?: NodeType | null
    name: string
}

enum NodeType {
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

enum StatusCode {
    UNSET = "UNSET",
    OK = "OK",
    ERROR = "ERROR",
}

interface ParentContextDTO {
    id: string
}

interface TimeDTO {
    start: string
    end: string
    span: number
}

interface StatusDTO {
    code: StatusCode
    message?: string | null
    stacktrace?: string | null
}
