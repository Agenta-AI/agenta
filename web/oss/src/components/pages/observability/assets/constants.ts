import {Download, Gear, LineSegments, Sparkle, TreeStructure} from "@phosphor-icons/react"

import {NodeType} from "@/oss/services/observability/types"

export const FILTER_COLUMNS = [
    {type: "exists", value: "tree.id", label: "Tree ID"},
    {type: "exists", value: "node.id", label: "Node ID"},
    {type: "exists", value: "node.type", label: "Node Type"},
    {type: "exists", value: "node.name", label: "Node Name"},
    {type: "number", value: "metrics.acc.duration.total", label: "Duration (ms)"},
    {type: "number", value: "metrics.acc.costs.total", label: "Cost ($)"},
    {type: "number", value: "metrics.acc.tokens.total", label: "Total Tokens"},
    {type: "number", value: "metrics.acc.tokens.prompt", label: "Prompt Tokens"},
    {type: "number", value: "metrics.acc.tokens.completion", label: "Completion Tokens"},
    {type: "exists", value: "status.code", label: "Status Code"},
    {type: "exists", value: "status.message", label: "Status Message"},
    {type: "exists", value: "exception.type", label: "Exception Type"},
    {type: "exists", value: "exception.message", label: "Exception Message"},
    {type: "exists", value: "exception.stacktrace", label: "Exception Stacktrace"},
    {type: "string", value: "content", label: "Content"},
    {type: "exists", value: "refs.application.id", label: "Application ID"},
    {type: "exists", value: "refs.application.slug", label: "Application Slug"},
    {type: "exists", value: "refs.variant.id", label: "Variant ID"},
    {type: "exists", value: "refs.variant.slug", label: "Variant Slug"},
    {type: "exists", value: "refs.variant.version", label: "Variant Version"},
    {type: "exists", value: "refs.environment.id", label: "Environment ID"},
    {type: "exists", value: "refs.environment.slug", label: "Environment Slug"},
    {type: "exists", value: "refs.environment.version", label: "Environment Version"},
]

export const nodeTypeStyles = {
    [NodeType.AGENT]: {
        bgColor: "#E6F4FF",
        color: "#4096FF",
        icon: Gear,
    },
    [NodeType.WORKFLOW]: {
        color: "#586673",
        bgColor: "#F5F7FA",
        icon: TreeStructure,
    },
    [NodeType.CHAIN]: {
        bgColor: "#E6F4FF",
        color: "#4096FF",
        icon: Gear,
    },
    [NodeType.TASK]: {
        bgColor: "#EAEFF5",
        color: "#586673",
        icon: TreeStructure,
    },
    [NodeType.TOOL]: {
        bgColor: "#F9F0FF",
        color: "#9254DE",
        icon: Download,
    },
    [NodeType.EMBEDDING]: {
        bgColor: "#FFFBE6",
        color: "#D4B106",
        icon: LineSegments,
    },
    [NodeType.COMPLETION]: {
        bgColor: "#E6FFFB",
        color: "#13C2C2",
        icon: Sparkle,
    },
    [NodeType.QUERY]: {
        bgColor: "#FFFBE6",
        color: "#D4B106",
        icon: LineSegments,
    },
    [NodeType.CHAT]: {
        bgColor: "#E6FFFB",
        color: "#13C2C2",
        icon: Sparkle,
    },
    [NodeType.RERANK]: {
        bgColor: "#FFFBE6",
        color: "#D4B106",
        icon: LineSegments,
    },
    default: {
        bgColor: "#F5F7FA",
        color: "#586673",
        icon: TreeStructure,
    },
}
