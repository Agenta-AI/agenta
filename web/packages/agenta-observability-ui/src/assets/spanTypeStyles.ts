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

/**
 * Span-type chip colours.
 *
 * Every value is a generated `--ag-*` token from `palette.ts`. The map used `--ant-*` instead,
 * which antd's ConfigProvider emits at runtime — so on an antd-free host (`/m`) those resolved
 * to nothing and the chips lost their background and text colour entirely. The `preset-*` pairs
 * are the supported hue contract and carry their own dark values.
 */
export const spanTypeStyles: Record<
    SpanCategory,
    {bgColor: string; color: string; icon: ComponentType<IconProps>}
> = {
    ["agent"]: {
        bgColor: "var(--ag-preset-blue-bg)",
        color: "var(--ag-preset-blue-text)",
        icon: Gear,
    },
    ["workflow"]: {
        color: "var(--ag-colorTextSecondary)",
        bgColor: "var(--ag-colorFillSecondary)",
        icon: TreeStructureIcon,
    },
    ["chain"]: {
        bgColor: "var(--ag-preset-blue-bg)",
        color: "var(--ag-preset-blue-text)",
        icon: Gear,
    },
    ["task"]: {
        bgColor: "var(--ag-zinc-2)",
        color: "var(--ag-colorTextSecondary)",
        icon: TreeStructureIcon,
    },
    ["tool"]: {
        bgColor: "var(--ag-preset-purple-bg)",
        color: "var(--ag-preset-purple-text)",
        icon: Download,
    },
    ["embedding"]: {
        bgColor: "var(--ag-preset-gold-bg)",
        color: "var(--ag-preset-gold-text)",
        icon: LineSegments,
    },
    ["completion"]: {
        bgColor: "var(--ag-preset-cyan-bg)",
        color: "var(--ag-preset-cyan-text)",
        icon: Sparkle,
    },
    ["query"]: {
        bgColor: "var(--ag-preset-gold-bg)",
        color: "var(--ag-preset-gold-text)",
        icon: LineSegments,
    },
    ["chat"]: {
        bgColor: "var(--ag-preset-cyan-bg)",
        color: "var(--ag-preset-cyan-text)",
        icon: Sparkle,
    },
    ["rerank"]: {
        bgColor: "var(--ag-preset-gold-bg)",
        color: "var(--ag-preset-gold-text)",
        icon: LineSegments,
    },
    ["llm"]: {
        bgColor: "var(--ag-preset-cyan-bg)",
        color: "var(--ag-preset-cyan-text)",
        icon: Sparkle,
    },
    ["unknown"]: {
        bgColor: "var(--ag-zinc-1)",
        color: "var(--ag-colorTextSecondary)",
        icon: TreeStructureIcon,
    },
}
