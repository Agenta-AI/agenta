/**
 * Per-item presentation classifiers: each `describe*` maps a raw config item (tool / MCP / skill /
 * instructions file) to an {@link ItemDescriptor} (avatar, name, description, tags). Kept beside the
 * predicates they rely on (`isFunctionTool`, `isStaticSkill`) so registry, rows, and drawers agree.
 */
import {humanizeActionKey} from "@agenta/shared/utils"
import {FileText, GraphIcon, Plugs, Robot} from "@phosphor-icons/react"

import {parseGatewayEntry, type ToolObj} from "../toolUtils"

/** How a config-item row presents itself: avatar, name + description, and type tags. */
export interface ItemDescriptor {
    /** Primary label (rendered monospace unless `monoName` is false). */
    name: string
    /** Render the name as prose, not monospace (e.g. a humanized connected-app action). @default mono */
    monoName?: boolean
    /** Secondary description line. */
    description?: string
    /** Avatar monogram, used when no `icon` is given. */
    mono: string
    /** Avatar background colour. */
    color: string
    /** Avatar icon (overrides the monogram). */
    icon?: React.ReactNode
    /** Avatar chip classes, for an item that paints its own chip. Set with `avatarStyle`. */
    avatarClassName?: string
    /** Custom properties the chip classes read (the light and dark tint and ink). */
    avatarStyle?: React.CSSProperties
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

/** Whether a tool is a `type:"reference"` workflow tool (#4860) — edited via its own detail view. */
export function isReferenceTool(tool: unknown): boolean {
    return Boolean(asObj(tool)?.type === "reference")
}

/** Two-char monogram, title-cased ("gmail" -> "Gm", "zendesk" -> "Ze"). */
export function monogram(value: string): string {
    return (value.charAt(0).toUpperCase() + (value.charAt(1) ?? "")).trim() || "?"
}

/** Uppercase the first character (leaves the rest untouched). */
function capitalizeFirst(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
}

/** A saved subagent row. Not `describeTool`: that returns the internal vocabulary (a "workflow"
 *  tag, a teal square, a monospace name), none of which is true of another agent. */
export function describeSubagent(
    tool: unknown,
    chrome?: {glyph: React.ReactNode; className: string; style?: React.CSSProperties},
    currentName?: string,
): ItemDescriptor {
    const t = (tool ?? {}) as Record<string, unknown>
    const slug = typeof t.slug === "string" ? t.slug : undefined
    // The target's CURRENT name wins: a reference saved before #6444 still carries a copy that a
    // rename never reached, and that copy is only a placeholder until the artifact resolves.
    const stored = typeof t.name === "string" && t.name ? t.name : undefined
    const name = currentName || stored || slug
    return {
        name: name ?? "Subagent",
        // Prose, never monospace: this is an agent's name, not an identifier.
        monoName: false,
        description: typeof t.description === "string" ? t.description : undefined,
        mono: "",
        color: "transparent",
        icon: chrome?.glyph ?? <Robot size={15} weight="fill" />,
        // Always chipped: an unchipped avatar paints white on transparent and the glyph vanishes.
        avatarClassName:
            chrome?.className ??
            "bg-[var(--ag-colorFillSecondary)] text-[var(--ag-colorTextSecondary)]",
        avatarStyle: chrome?.style,
        // No type tag. "workflow" is an internal type and nothing user-meaningful replaces it.
        tags: [],
        typeLabel: "subagent",
        typeColor: "geekblue",
        subtitle: slug ? `Subagent · ${slug}` : "Subagent",
    }
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

    // A gateway entry: a whole integration, or one third-party action (canonical or legacy slug).
    const entry = parseGatewayEntry(t)
    if (entry?.kind === "connection") {
        const {connection} = entry
        return {
            name: capitalizeFirst(connection.integration),
            monoName: false,
            mono: monogram(connection.integration),
            color: "#1c2c3d",
            icon: <Plugs size={15} weight="fill" />,
            tags: [connection.integration],
            typeLabel: "integration",
            subtitle: `Integration · ${connection.integration} · ${connection.connection} connection`,
        }
    }
    if (entry) {
        const gateway = entry.action
        return {
            // The key often repeats the integration (GITHUB_ADD_...); the group header already
            // names the app, so the helper drops the prefix before humanizing.
            name: humanizeActionKey(gateway.action, gateway.integration),
            monoName: false,
            description: description ? capitalizeFirst(description) : undefined,
            mono: monogram(gateway.integration),
            color: "#1c2c3d",
            tags: [gateway.integration],
            typeLabel: "third-party",
            subtitle: `Connected app tool · ${gateway.integration}`,
        }
    }

    // Built-in / provider tool: a bare `type` with no editable `function`.
    if (!fn || typeof fn !== "object") {
        // Provider built-ins such as {type:"web_search_preview"} carry no name, so their `type`
        // is the name. (Harness built-ins are always active and never reach the list.)
        const builtinName = typeof t.name === "string" && t.name ? (t.name as string) : undefined
        const typeValue =
            typeof t.type === "string" && t.type !== "function"
                ? (t.type as string)
                : Object.keys(t).find((k) => k !== "type" && k !== "function")
        return {
            name: builtinName ?? typeValue ?? "Built-in tool",
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
    const connection =
        s.connection && typeof s.connection === "object"
            ? (s.connection as Record<string, unknown>)
            : {}
    const name = typeof s.name === "string" && s.name ? (s.name as string) : "MCP server"
    return {
        name,
        description: typeof connection.url === "string" ? connection.url : undefined,
        mono: "",
        color: "#2563eb",
        icon: <Plugs size={15} weight="fill" />,
        tags: ["HTTP"],
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

/** Display name for an embedded skill: the embed's sibling `name`, else the referenced workflow's
 * `name`. Callers fall back to the slug when this is undefined. */
export function staticEmbedName(skill: Record<string, unknown>): string | undefined {
    if (typeof skill.name === "string" && skill.name) return skill.name
    const refs = asObj(asObj(skill["@ag.embed"])?.["@ag.references"])
    const wfName = asObj(refs?.workflow)?.name ?? asObj(refs?.workflow_revision)?.name
    return typeof wfName === "string" && wfName ? wfName : undefined
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
            name: staticEmbedName(s) ?? slug ?? "Static skill",
            mono: "sk",
            color: "#6b7280",
            tags: version ? ["static", `v${version}`] : ["static"],
            typeLabel: "static skill",
            subtitle: "Provided by Agenta — read-only",
        }
    }
    if (isEmbedRefSkill(s)) {
        return {
            name: staticEmbedName(s) ?? staticEmbedSlug(s) ?? "Skill reference",
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
