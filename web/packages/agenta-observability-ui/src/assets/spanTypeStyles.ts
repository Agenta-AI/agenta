import type {ComponentType} from "react"

import type {SpanCategory} from "@agenta/entities/trace"
import {
    Download,
    Gear,
    LineSegments,
    Sparkle,
    TreeStructureIcon,
    type IconProps,
} from "@phosphor-icons/react"

export const spanTypeStyles: Record<
    SpanCategory,
    {bgColor: string; color: string; icon: ComponentType<IconProps>}
> = {
    ["agent"]: {
        bgColor: "var(--ant-blue-1)",
        color: "var(--ant-blue-5)",
        icon: Gear,
    },
    ["workflow"]: {
        color: "var(--ant-color-text-secondary)",
        bgColor: "var(--ant-color-fill-secondary)",
        icon: TreeStructureIcon,
    },
    ["chain"]: {
        bgColor: "var(--ant-blue-1)",
        color: "var(--ant-blue-5)",
        icon: Gear,
    },
    ["task"]: {
        bgColor: "var(--ag-zinc-2)",
        color: "var(--ant-color-text-secondary)",
        icon: TreeStructureIcon,
    },
    ["tool"]: {
        bgColor: "var(--ant-purple-1)",
        color: "var(--ant-purple-5)",
        icon: Download,
    },
    ["embedding"]: {
        bgColor: "var(--ant-gold-1)",
        color: "var(--ant-gold-7)",
        icon: LineSegments,
    },
    ["completion"]: {
        bgColor: "var(--ant-cyan-1)",
        color: "var(--ant-cyan-6)",
        icon: Sparkle,
    },
    ["query"]: {
        bgColor: "var(--ant-gold-1)",
        color: "var(--ant-gold-7)",
        icon: LineSegments,
    },
    ["chat"]: {
        bgColor: "var(--ant-cyan-1)",
        color: "var(--ant-cyan-6)",
        icon: Sparkle,
    },
    ["rerank"]: {
        bgColor: "var(--ant-gold-1)",
        color: "var(--ant-gold-7)",
        icon: LineSegments,
    },
    ["llm"]: {
        bgColor: "var(--ant-cyan-1)",
        color: "var(--ant-cyan-6)",
        icon: Sparkle,
    },
    ["unknown"]: {
        bgColor: "var(--ag-zinc-1)",
        color: "var(--ant-color-text-secondary)",
        icon: TreeStructureIcon,
    },
}
