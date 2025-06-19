import {_AgentaRootsResponse} from "@/oss/services/observability/types"

export const filterColumns = [
    {type: "exists", value: "tree.id", label: "tree ID"},
    {type: "exists", value: "node.id", label: "node ID"},
    {type: "exists", value: "node.type", label: "node type"},
    {type: "exists", value: "node.name", label: "node name"},
    {type: "exists", value: "status.code", label: "status code"},
    {type: "exists", value: "status.message", label: "status message"},
    {type: "exists", value: "exception.type", label: "exception type"},
    {type: "exists", value: "exception.message", label: "exception message"},
    {type: "exists", value: "exception.stacktrace", label: "exception stacktrace"},
    {type: "string", value: "content", label: "content"},
    {type: "number", value: "metrics.acc.duration.total", label: "duration"},
    {type: "number", value: "metrics.acc.costs.total", label: "cost"},
    {
        type: "number",
        value: "metrics.acc.tokens.prompt",
        label: "prompt tokens (accumulated)",
    },
    {
        type: "number",
        value: "metrics.acc.tokens.completion",
        label: "completion tokens (accumulated)",
    },
    {type: "number", value: "metrics.acc.tokens.total", label: "usage"},
    {type: "number", value: "metrics.unit.tokens.prompt", label: "prompt tokens"},
    {type: "number", value: "metrics.unit.tokens.completion", label: "completion tokens"},
    {type: "exists", value: "refs.variant.id", label: "variant ID"},
    {type: "exists", value: "refs.variant.slug", label: "variant slug"},
    {type: "exists", value: "refs.variant.version", label: "variant version"},
    {type: "exists", value: "refs.environment.id", label: "environment ID"},
    {type: "exists", value: "refs.environment.slug", label: "environment slug"},
    {type: "exists", value: "refs.environment.version", label: "environment version"},
    {type: "exists", value: "refs.application.id", label: "application ID"},
    {type: "exists", value: "refs.application.slug", label: "application slug"},
]

export const filterTree = (node: _AgentaRootsResponse, search: string) => {
    const nameMatches = node.node?.name?.toLowerCase().includes(search.toLowerCase())

    const filteredChildren = (node.children || [])
        .map((child) => filterTree(child, search))
        .filter(Boolean) as _AgentaRootsResponse[]

    if (nameMatches || filteredChildren.length > 0) {
        return {
            ...node,
            children: filteredChildren,
        }
    }

    return null
}
