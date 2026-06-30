/**
 * Per-item presentation classifiers: each `describe*` maps a raw config item (tool / MCP / skill /
 * instructions file) to an {@link ItemDescriptor} (avatar, name, description, tags). Kept beside the
 * predicates they rely on (`isFunctionTool`, `isStaticSkill`) so registry, rows, and drawers agree.
 */
import {FileText, GraphIcon, Plugs} from "@phosphor-icons/react"

import {parseGatewayFunctionName, type ToolObj} from "../toolUtils"

/** How a config-item row presents itself: avatar, name + description, and type tags. */
export interface ItemDescriptor {
    /** Primary label (rendered monospace). */
    name: string
    /** Secondary description line. */
    description?: string
    /** Avatar monogram, used when no `icon` is given. */
    mono: string
    /** Avatar background colour. */
    color: string
    /** Avatar icon (overrides the monogram). */
    icon?: React.ReactNode
    /** Type tags shown on the right of a row (e.g. "built-in", "definition", "gmail"). */
    tags: string[]
    /** Type label for the drawer header badge (e.g. "definition", "MCP server"). */
    typeLabel: string
    /** antd Tag colour for the header badge. */
    typeColor?: string
    /** One-line type description shown as the drawer subtitle. */
    subtitle: string
}

/** Read the function name of a tool object (the gateway slug for Composio tools). */
export function toolName(tool: unknown): string | undefined {
    if (!tool || typeof tool !== "object") return undefined
    const fn = (tool as Record<string, unknown>).function
    if (!fn || typeof fn !== "object") return undefined
    const name = (fn as Record<string, unknown>).name
    return typeof name === "string" ? name : undefined
}

/** Slug a `type:"reference"` tool targets (undefined for any other tool). Dedupes referenced
 * workflows; ignores gateway function names so a same-named gateway tool can't shadow a workflow. */
export function toolReferenceSlug(tool: unknown): string | undefined {
    if (!tool || typeof tool !== "object") return undefined
    const t = tool as Record<string, unknown>
    if (t.type !== "reference") return undefined
    return typeof t.slug === "string" ? (t.slug as string) : undefined
}

export function isBuiltinPayloadMatch(tool: unknown, payload: ToolObj): boolean {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false

    const toolObj = tool as Record<string, unknown>
    const payloadObj = payload as Record<string, unknown>

    if (typeof payloadObj.type === "string" && toolObj.type === payloadObj.type) return true
    if (typeof payloadObj.name === "string" && toolObj.name === payloadObj.name) return true

    const payloadKeys = Object.keys(payloadObj)
    return (
        payloadKeys.length === 1 &&
        payloadKeys[0] !== "type" &&
        payloadKeys[0] !== "name" &&
        payloadKeys[0] in toolObj
    )
}

/** Whether a tool has an editable OpenAI-style `function` (vs a bare builtin `type`). */
export function isFunctionTool(tool: unknown): boolean {
    if (!tool || typeof tool !== "object") return false
    const fn = (tool as Record<string, unknown>).function
    return Boolean(fn && typeof fn === "object")
}

/** Two-char monogram, title-cased ("gmail" -> "Gm", "zendesk" -> "Ze"). */
export function monogram(value: string): string {
    return (value.charAt(0).toUpperCase() + (value.charAt(1) ?? "")).trim() || "?"
}

/** Classify a tool into its row avatar / name / description / type tags. */
export function describeTool(tool: unknown): ItemDescriptor {
    const t = (tool ?? {}) as Record<string, unknown>
    const fn = t.function as Record<string, unknown> | undefined
    const fnName = typeof fn?.name === "string" ? (fn.name as string) : undefined
    const description = typeof fn?.description === "string" ? (fn.description as string) : undefined

    // Workflow reference tool (type:"reference", #4860): a referenced workflow the backend runs
    // server-side as a callback tool. Detected by the discriminator BEFORE the builtin fallback
    // (which would otherwise misclassify it as built-in).
    if (t.type === "reference") {
        const slug = typeof t.slug === "string" ? (t.slug as string) : undefined
        const refName = typeof t.name === "string" ? (t.name as string) : undefined
        const target =
            t.ref_by === "environment" && typeof t.environment === "string"
                ? `${slug ?? ""} @ ${t.environment as string}`
                : typeof t.version === "string"
                  ? `${slug ?? ""} v${t.version as string}`
                  : slug
        return {
            name: refName ?? slug ?? "Workflow tool",
            description: typeof t.description === "string" ? (t.description as string) : undefined,
            mono: "",
            color: "#0d9488",
            icon: <GraphIcon size={15} weight="fill" />,
            tags: ["workflow"],
            typeLabel: "workflow",
            typeColor: "geekblue",
            subtitle: target ? `Referenced workflow · ${target}` : "Referenced workflow",
        }
    }

    // Third-party / gateway tool: tools__provider__integration__action__connection.
    const gateway = fnName ? parseGatewayFunctionName(fnName) : null
    if (gateway) {
        return {
            name: gateway.action,
            description,
            mono: monogram(gateway.integration),
            color: "#1c2c3d",
            tags: [gateway.integration],
            typeLabel: "third-party",
            subtitle: `Connected app tool · ${gateway.integration}`,
        }
    }

    // Built-in / provider tool: a bare `type` with no editable `function`.
    if (!fn || typeof fn !== "object") {
        const typeValue =
            typeof t.type === "string" && t.type !== "function"
                ? (t.type as string)
                : Object.keys(t).find((k) => k !== "type" && k !== "function")
        return {
            name: typeValue ?? "Built-in tool",
            mono: "io",
            color: "#0d9488",
            tags: ["built-in"],
            typeLabel: "built-in",
            typeColor: "cyan",
            subtitle: "Provider built-in tool",
        }
    }

    // Function definition (custom inline tool).
    return {
        name: fnName ?? "Tool",
        description,
        mono: "{}",
        color: "#7c3aed",
        tags: ["definition"],
        typeLabel: "definition",
        typeColor: "purple",
        subtitle: "Schema-only · executed by your app",
    }
}

/** Classify an MCP server into its row avatar / name / description / tags. */
export function describeMcp(server: unknown): ItemDescriptor {
    const s = (server ?? {}) as Record<string, unknown>
    const transport = s.transport === "http" ? "http" : "stdio"
    const name = typeof s.name === "string" && s.name ? (s.name as string) : "MCP server"
    const detailField = transport === "http" ? s.url : s.command
    return {
        name,
        description: typeof detailField === "string" ? detailField : undefined,
        mono: "",
        color: "#2563eb",
        icon: <Plugs size={15} weight="fill" />,
        tags: [transport],
        typeLabel: "MCP server",
        typeColor: "cyan",
        subtitle: "Model Context Protocol server",
    }
}

export function asObj(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined
}

/**
 * A skills entry is either an inline SKILL.md package or an `@ag.embed` reference (which the
 * backend inlines). Embed refs carry the marker at the top level and must round-trip intact, so
 * they're edited JSON-only rather than through the structured form.
 */
export function isEmbedRefSkill(skill: unknown): boolean {
    return Boolean(
        skill && typeof skill === "object" && "@ag.embed" in (skill as Record<string, unknown>),
    )
}

/** The reserved slug namespace for static (Agenta-owned) skills (mirrors the backend `__ag__*`). */
const STATIC_SKILL_SLUG_PREFIX = "__ag__"

/** The slug an `@ag.embed` entry points at (a `workflow` or pinned `workflow_revision` reference). */
export function staticEmbedSlug(skill: Record<string, unknown>): string | undefined {
    const refs = asObj(asObj(skill["@ag.embed"])?.["@ag.references"])
    if (!refs) return undefined
    const slug = asObj(refs.workflow)?.slug ?? asObj(refs.workflow_revision)?.slug
    return typeof slug === "string" ? slug : undefined
}

/** A pinned revision's version, when the embed references a `workflow_revision`. */
function embedRevisionVersion(skill: Record<string, unknown>): string | undefined {
    const refs = asObj(asObj(skill["@ag.embed"])?.["@ag.references"])
    const version = asObj(refs?.workflow_revision)?.version
    return typeof version === "string" ? version : undefined
}

/**
 * Whether a skill entry is static (Agenta-owned) and so read-only for the author. The reliable client-side
 * signal is the reserved `__ag__` slug prefix on the embed's referenced workflow (or pinned
 * revision); a resolved object carrying `flags.is_static === true` counts too.
 */
export function isStaticSkill(skill: unknown): boolean {
    const s = asObj(skill)
    if (!s) return false
    const slug = staticEmbedSlug(s)
    if (slug && slug.startsWith(STATIC_SKILL_SLUG_PREFIX)) return true
    return asObj(s.flags)?.is_static === true
}

/** Classify a skill into its row avatar / name / description / type tags. */
export function describeSkill(skill: unknown): ItemDescriptor {
    const s = (skill ?? {}) as Record<string, unknown>
    if (isStaticSkill(s)) {
        const slug = staticEmbedSlug(s)
        const version = embedRevisionVersion(s)
        return {
            name: slug ?? "Static skill",
            mono: "sk",
            color: "#6b7280",
            tags: version ? ["static", `v${version}`] : ["static"],
            typeLabel: "static skill",
            subtitle: "Provided by Agenta — read-only",
        }
    }
    if (isEmbedRefSkill(s)) {
        return {
            name: "Skill reference",
            mono: "sk",
            color: "#b45309",
            tags: ["@ag.embed"],
            typeLabel: "@ag.embed",
            typeColor: "blue",
            subtitle: "Referenced skill — inlined by the backend",
        }
    }
    return {
        name: typeof s.name === "string" && s.name ? (s.name as string) : "Skill",
        description: typeof s.description === "string" ? (s.description as string) : undefined,
        mono: "sk",
        color: "#b45309",
        tags: ["skill"],
        typeLabel: "skill",
        typeColor: "gold",
        subtitle: "Inline SKILL.md package",
    }
}

/** Strip Markdown syntax to a short single-line preview for an instructions file row. */
export function mdPreview(md: string): string {
    return (md ?? "")
        .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
        .replace(/^#{1,6}\s+/gm, "") // heading markers
        .replace(/^\s*[-*+]\s+/gm, "") // bullet list markers (so "- Greet…" reads as prose)
        .replace(/^\s*\d+\.\s+/gm, "") // numbered list markers
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links/images → their text
        .replace(/[*_`>#]/g, "") // inline emphasis / quote chars
        .replace(/\s+/g, " ") // collapse newlines + runs of whitespace
        .trim()
        .slice(0, 140)
}

/** Row descriptor for an instructions markdown file (e.g. AGENTS.md). */
export function describeInstruction(filename: string, content: string): ItemDescriptor {
    return {
        name: filename,
        description: mdPreview(content) || "Empty file",
        mono: "md",
        color: "#0f766e",
        icon: <FileText size={14} />,
        tags: [],
        typeLabel: "instructions",
        subtitle: "Markdown instructions for the agent",
    }
}
