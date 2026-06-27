/**
 * AgentConfigControl
 *
 * The agent playground's left config panel. It renders the whole agent config as a set
 * of collapsible accordion sections (Model & harness, Instructions, Tools, MCP servers,
 * Advanced), built on the reusable {@link ConfigAccordionSection} primitive so the same
 * pattern can roll out to other config surfaces.
 *
 * Dispatched from `x-ag-type: "agent_config"` / `x-ag-type-ref: "agent_config"` (see
 * SchemaPropertyRenderer). It reuses the existing schema controls rather than inventing
 * new ones: the model selector (GroupedChoiceControl), the tool picker (ToolSelectorPopover
 * + ToolItemControl), the MCP server editor (McpServerItemControl), enum selects (harness,
 * sandbox, permission policy), and a textarea (agents_md). The field shape is the
 * `agent_config` catalog type generated from the SDK model (AgentConfigSchema in
 * agenta.sdk.utils.types); the agent service ships a thin `x-ag-type-ref` the playground
 * resolves and reads back (services/oss/src/agent).
 *
 * Sections are schema-driven: each renders only when its field exists in the resolved
 * schema, so the panel tracks the backend contract instead of hard-coding fields.
 */
import {useCallback, useEffect, useMemo, useState} from "react"

import {vaultSecretsQueryAtom} from "@agenta/entities/secret"
import type {SchemaProperty} from "@agenta/entities/shared"
import {harnessCapabilitiesAtomFamily} from "@agenta/entities/workflow"
import {ConfigAccordionSection, LabeledField} from "@agenta/ui/components/presentational"
import {useDrillInUI, type WorkflowReferencePayload} from "@agenta/ui/drill-in"
import {SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"
import {cn} from "@agenta/ui/styles"
import {
    CaretRight,
    Cpu,
    FileText,
    GraduationCap,
    GraphIcon,
    Plugs,
    Plus,
    SlidersHorizontal,
    Trash,
    Wrench,
} from "@phosphor-icons/react"
import {Button, Select, Switch, Tabs, Tag, Tooltip, Typography} from "antd"
import {useAtomValue} from "jotai"

import {useOptionalDrillIn} from "../components/MoleculeDrillInContext"

import {agentConfigLayoutAtom} from "./agentConfigLayout"
import {ClaudePermissionsControl} from "./ClaudePermissionsControl"
import {CodeEditor} from "./CodeEditor"
import {ConfigItemDrawer, type ConfigItemView} from "./ConfigItemDrawer"
import {
    allowedConnectionModes,
    buildModelOptionGroups,
    composeModelValue,
    connectionFromConfig,
    harnessAllowsModel,
    modelIdFromConfig,
    namedConnectionOptions,
    providerForModel,
    type ConnectionMode,
    type VaultConnectionEntry,
} from "./connectionUtils"
import {EnumSelectControl} from "./EnumSelectControl"
import {GroupedChoiceControl} from "./GroupedChoiceControl"
import {HarnessSelectControl} from "./HarnessSelectControl"
import {JsonObjectEditor} from "./JsonObjectEditor"
import {MarkdownEditor} from "./MarkdownEditor"
import {McpServerFormView} from "./McpServerFormView"
import {SandboxPermissionControl} from "./SandboxPermissionControl"
import {SkillFormView} from "./SkillFormView"
import {ToolFormView} from "./ToolFormView"
import {ToolSelectorPopover, type ToolSelectionMeta} from "./ToolSelectorPopover"
import {parseGatewayFunctionName, type ToolObj} from "./toolUtils"
import {WorkflowReferenceSelector} from "./WorkflowReferenceSelector"

export interface AgentConfigControlProps {
    schema?: SchemaProperty | null
    label?: string
    value?: Record<string, unknown> | null
    onChange: (value: Record<string, unknown>) => void
    description?: string
    withTooltip?: boolean
    disabled?: boolean
    className?: string
}

/** Read the function name of a tool object (the gateway slug for Composio tools). */
function toolName(tool: unknown): string | undefined {
    if (!tool || typeof tool !== "object") return undefined
    const fn = (tool as Record<string, unknown>).function
    if (!fn || typeof fn !== "object") return undefined
    const name = (fn as Record<string, unknown>).name
    return typeof name === "string" ? name : undefined
}

/** The workflow slug a reference tool (`type:"reference"`) targets, else the function name (the
 * gateway slug). Used to dedupe the workflows offered in the reference drawer. */
function toolReferenceSlug(tool: unknown): string | undefined {
    if (!tool || typeof tool !== "object") return undefined
    const t = tool as Record<string, unknown>
    if (t.type === "reference") {
        return typeof t.slug === "string" ? (t.slug as string) : undefined
    }
    const fn = asObj(t.function)
    return fn && typeof fn.name === "string" ? (fn.name as string) : undefined
}

function isBuiltinPayloadMatch(tool: unknown, payload: ToolObj): boolean {
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

/**
 * Best-effort display label for an enum value, used in collapsed section summaries.
 * Reads `x-model-metadata` titles and `anyOf`/`oneOf` const titles, falling back to the
 * raw value so a summary is always shown.
 */
function enumLabel(schema: SchemaProperty | undefined, value: unknown): string | null {
    if (value == null || value === "") return null
    const v = String(value)
    const s = schema as Record<string, unknown> | undefined
    const meta = s?.["x-model-metadata"] as Record<string, {name?: string}> | undefined
    if (meta?.[v]?.name) return meta[v]!.name as string
    const variants = (s?.anyOf ?? s?.oneOf) as {const?: unknown; title?: string}[] | undefined
    const hit = variants?.find((o) => o?.const === value)
    if (hit?.title) return hit.title
    return v
}

const countSummary = (n: number, noun: string): string =>
    n > 0 ? `${n} ${noun}${n === 1 ? "" : "s"}` : "None"

/** Whether a tool has an editable OpenAI-style `function` (vs a bare builtin `type`). */
function isFunctionTool(tool: unknown): boolean {
    if (!tool || typeof tool !== "object") return false
    const fn = (tool as Record<string, unknown>).function
    return Boolean(fn && typeof fn === "object")
}

/** How a config-item row presents itself: avatar, name + description, and type tags. */
interface ItemDescriptor {
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

/** Two-char monogram, title-cased ("gmail" -> "Gm", "zendesk" -> "Ze"). */
function monogram(value: string): string {
    return (value.charAt(0).toUpperCase() + (value.charAt(1) ?? "")).trim() || "?"
}

/** Deep-clone a config item so drawer edits don't alias the committed config object. */
function cloneItem(item: unknown): Record<string, unknown> {
    if (!item || typeof item !== "object") return {}
    return JSON.parse(JSON.stringify(item)) as Record<string, unknown>
}

/** Classify a tool into its row avatar / name / description / type tags. */
function describeTool(tool: unknown): ItemDescriptor {
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
function describeMcp(server: unknown): ItemDescriptor {
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

/**
 * A skills entry is either an inline SKILL.md package or an `@ag.embed` reference (which the
 * backend inlines). Embed refs carry the marker at the top level and must round-trip intact, so
 * they're edited JSON-only rather than through the structured form.
 */
function isEmbedRefSkill(skill: unknown): boolean {
    return Boolean(
        skill && typeof skill === "object" && "@ag.embed" in (skill as Record<string, unknown>),
    )
}

/** Classify a skill into its row avatar / name / description / type tags. */
function asObj(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined
}

/** The reserved slug namespace for platform-owned skills (mirrors the backend `_agenta.*`). */
const PLATFORM_SKILL_SLUG_PREFIX = "_agenta."

/** The slug an `@ag.embed` entry points at (a `workflow` or pinned `workflow_revision` reference). */
function platformEmbedSlug(skill: Record<string, unknown>): string | undefined {
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
 * Whether a skill entry is platform-owned and so read-only for the author. The reliable client-side
 * signal is the reserved `_agenta.` slug prefix on the embed's referenced workflow (or pinned
 * revision); a resolved object carrying `flags.is_platform === true` counts too.
 */
function isPlatformSkill(skill: unknown): boolean {
    const s = asObj(skill)
    if (!s) return false
    const slug = platformEmbedSlug(s)
    if (slug && slug.startsWith(PLATFORM_SKILL_SLUG_PREFIX)) return true
    return asObj(s.flags)?.is_platform === true
}

function describeSkill(skill: unknown): ItemDescriptor {
    const s = (skill ?? {}) as Record<string, unknown>
    if (isPlatformSkill(s)) {
        const slug = platformEmbedSlug(s)
        const version = embedRevisionVersion(s)
        return {
            name: slug ?? "Platform skill",
            mono: "sk",
            color: "#6b7280",
            tags: version ? ["platform", `v${version}`] : ["platform"],
            typeLabel: "platform skill",
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

/** Colored avatar square (icon or monogram) at the start of a config-item row. */
function ItemAvatar({descriptor}: {descriptor: ItemDescriptor}) {
    return (
        <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-white"
            style={{background: descriptor.color, fontSize: 10, fontWeight: 600, lineHeight: 1}}
        >
            {descriptor.icon ?? descriptor.mono}
        </span>
    )
}

/**
 * A config-item row (a tool or MCP server): type avatar, name + description, type tags, and a
 * chevron. The whole row opens the item drawer; remove appears on hover.
 */
function ItemRow({
    descriptor,
    onEdit,
    onRemove,
    disabled,
}: {
    descriptor: ItemDescriptor
    onEdit: () => void
    onRemove?: () => void
    disabled?: boolean
}) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onEdit}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onEdit()
                }
            }}
            className="group flex cursor-pointer items-center gap-2.5 rounded border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] px-3 py-2 transition-colors hover:border-[var(--ag-c-97A4B0,#97a4b0)]"
        >
            <ItemAvatar descriptor={descriptor} />
            <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs font-medium">{descriptor.name}</div>
                {descriptor.description ? (
                    <Typography.Text
                        type="secondary"
                        className="block truncate text-xs leading-tight"
                    >
                        {descriptor.description}
                    </Typography.Text>
                ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
                {descriptor.tags.map((tag) => (
                    <Tag key={tag} className="m-0 text-[11px]">
                        {tag}
                    </Tag>
                ))}
                {onRemove && !disabled ? (
                    <button
                        type="button"
                        aria-label="Remove"
                        onClick={(e) => {
                            e.stopPropagation()
                            onRemove()
                        }}
                        className="flex cursor-pointer items-center border-0 bg-transparent p-0 text-[var(--ag-c-97A4B0,#97a4b0)] opacity-0 transition-opacity hover:text-[var(--ag-c-FF4D4F,#ff4d4f)] group-hover:opacity-100"
                    >
                        <Trash size={14} />
                    </button>
                ) : null}
                <CaretRight size={14} className="text-[var(--ag-c-97A4B0,#97a4b0)]" />
            </div>
        </div>
    )
}

export function AgentConfigControl({
    schema,
    value,
    onChange,
    withTooltip,
    disabled,
    className,
}: AgentConfigControlProps) {
    const {gatewayTools, workflowReference} = useDrillInUI()
    const config = (value ?? {}) as Record<string, unknown>

    // The item-config drawer (tools / MCP servers). Edits happen on a local `draft`; they only
    // apply to the config on Save. So creating an item never pollutes the config until confirmed,
    // and editing an existing item can be cancelled cleanly (Cancel/X discards the draft).
    const [editing, setEditing] = useState<{
        kind: "tool" | "mcp" | "skill"
        mode: "create" | "edit"
        index: number
    } | null>(null)
    const [draft, setDraft] = useState<Record<string, unknown>>({})
    const [drawerView, setDrawerView] = useState<ConfigItemView>("form")
    const [referenceSelectorOpen, setReferenceSelectorOpen] = useState(false)
    const openCreate = useCallback(
        (kind: "tool" | "mcp" | "skill", seed: Record<string, unknown>, view: ConfigItemView) => {
            setDraft(seed)
            setDrawerView(view)
            setEditing({kind, mode: "create", index: -1})
        },
        [],
    )
    const openEdit = useCallback(
        (kind: "tool" | "mcp" | "skill", index: number, item: unknown, view: ConfigItemView) => {
            setDraft(cloneItem(item))
            setDrawerView(view)
            setEditing({kind, mode: "edit", index})
        },
        [],
    )
    const closeEditor = useCallback(() => setEditing(null), [])

    // How the config sections are laid out: stacked accordion (default), tabs, or cards.
    // Layout is a global, persisted preference set from the variant header menu (see
    // agentConfigLayout); the panel only reads it.
    const layout = useAtomValue(agentConfigLayoutAtom)
    const props = (schema?.properties ?? {}) as Record<string, SchemaProperty>

    // Update a single field of the agent config, leaving the rest intact.
    const setField = useCallback(
        (key: string, fieldValue: unknown) => onChange({...config, [key]: fieldValue}),
        [config, onChange],
    )

    // Model + credential connection (the ModelRef). `config.model` is ALWAYS a structured ModelRef
    // (the harness-filtered picker only ever produces one); a legacy bare string is read for
    // display. composeModelValue carries through extra keys (e.g. `params`) so a form edit never
    // silently drops them. The picker is harness-filtered: selecting a model sets BOTH the model id
    // and its provider, fed by the `/inspect` capability map below.
    const harnessValue = typeof config.harness === "string" ? config.harness : null
    // Pi (`pi_core`/`pi_agenta`) never gates tool use (`permissions: false`); a permission
    // policy is meaningless for it, so the field is hidden for Pi. Only Claude honors it.
    const isPiHarness = harnessValue === "pi_core" || harnessValue === "pi_agenta"
    const modelId = useMemo(() => modelIdFromConfig(config.model), [config.model])
    const connection = useMemo(() => connectionFromConfig(config.model), [config.model])

    // Per-harness capability map from the `/inspect` response meta, keyed by the open revision.
    // Null when inspect hasn't resolved or the agent didn't publish it (older agents / standalone),
    // in which case the connectionUtils helpers fall back permissively.
    const drillIn = useOptionalDrillIn<unknown>()
    const revisionId = drillIn?.entityId ?? null
    const capabilities = useAtomValue(
        useMemo(() => harnessCapabilitiesAtomFamily(revisionId ?? ""), [revisionId]),
    )

    // The project's stored connections (read-only) for the connection picker. The transformed vault
    // list surfaces custom-provider connections as {type, name, provider}; the resolver matches a
    // named connection by that name (the slug).
    const vaultQuery = useAtomValue(vaultSecretsQueryAtom)
    const vaultSecrets = useMemo(
        () => (Array.isArray(vaultQuery.data) ? (vaultQuery.data as VaultConnectionEntry[]) : []),
        [vaultQuery.data],
    )

    const modeOptions = useMemo(
        () => allowedConnectionModes(capabilities, harnessValue),
        [capabilities, harnessValue],
    )

    // Harness-filtered model options, built straight from inspect meta. Empty when the harness
    // publishes none (older agent / standalone) — fall back to the schema's full catalog picker.
    const modelGroups = useMemo(
        () => buildModelOptionGroups(capabilities, harnessValue),
        [capabilities, harnessValue],
    )
    const hasInspectModels = modelGroups.length > 0

    // Compose the new `config.model` ModelRef from the current fields, overriding some. Picking a
    // model derives its provider from the harness's published groups (sets both).
    const writeModel = useCallback(
        (patch: {
            modelId?: string | null
            provider?: string | null
            mode?: ConnectionMode
            slug?: string | null
        }) => {
            const nextModelId = patch.modelId !== undefined ? patch.modelId : modelId
            // When the model changes, derive the provider from the picked model; otherwise keep it.
            let nextProvider: string | null
            if (patch.provider !== undefined) {
                nextProvider = patch.provider
            } else if (patch.modelId !== undefined) {
                nextProvider =
                    providerForModel(capabilities, harnessValue, nextModelId) ?? connection.provider
            } else {
                nextProvider = connection.provider
            }
            setField(
                "model",
                composeModelValue({
                    modelId: nextModelId,
                    provider: nextProvider,
                    mode: patch.mode !== undefined ? patch.mode : connection.mode,
                    slug: patch.slug !== undefined ? patch.slug : connection.slug,
                    existing: config.model,
                }),
            )
        },
        [setField, modelId, connection, config.model, capabilities, harnessValue],
    )

    // On harness switch, clear a model the new harness can't reach (rather than sending an
    // unsupported model). Permissive when the new harness publishes no models.
    useEffect(() => {
        if (!harnessValue || !modelId) return
        if (!harnessAllowsModel(capabilities, harnessValue, modelId)) {
            // Drop the stale named connection too, not just the model id/provider.
            writeModel({modelId: null, provider: null, slug: null})
        }
        // Only react to harness/capabilities changes, not every model edit.
    }, [harnessValue, capabilities])

    // Also reset a connection mode the new harness no longer allows. Guarded on a non-empty
    // option set so a harness that publishes no modes stays permissive (and we never loop).
    // Slug validity is intentionally NOT normalized here: connectionOptions is vault-secret
    // async, so an empty set during load would wrongly clear a valid slug.
    useEffect(() => {
        if (modeOptions.length > 0 && !modeOptions.includes(connection.mode)) {
            writeModel({mode: modeOptions[0], slug: null})
        }
    }, [connection.mode, modeOptions, writeModel])

    // Named connections selectable for the chosen provider under this harness (Agenta-managed).
    const connectionOptions = useMemo(
        () => namedConnectionOptions(vaultSecrets, capabilities, harnessValue, connection.provider),
        [vaultSecrets, capabilities, harnessValue, connection.provider],
    )

    // Raw-JSON escape hatch for the whole `config.model` value (collapsed by default).
    const [showModelJson, setShowModelJson] = useState(false)
    const [modelJsonText, setModelJsonText] = useState(() =>
        JSON.stringify(config.model ?? "", null, 2),
    )
    const handleModelJsonChange = useCallback(
        (text: string) => {
            setModelJsonText(text)
            try {
                setField("model", text ? JSON.parse(text) : "")
            } catch {
                // Keep the invalid text in the editor; don't propagate until it parses.
            }
        },
        [setField],
    )
    const handleToggleModelJson = useCallback(
        (next: boolean) => {
            if (next) setModelJsonText(JSON.stringify(config.model ?? "", null, 2))
            setShowModelJson(next)
        },
        [config.model],
    )
    // Keep the open JSON buffer in sync when `config.model` changes from OUTSIDE the editor
    // (the model picker or the authentication cards). Guard with a structural compare so we
    // only resync on external changes — when the buffer already represents `config.model`
    // (the user is typing here) we skip, so we never reformat mid-edit or fight the cursor.
    useEffect(() => {
        if (!showModelJson) return
        let bufferValue: unknown
        try {
            bufferValue = modelJsonText ? JSON.parse(modelJsonText) : ""
        } catch {
            return // invalid in-progress JSON — leave the user's text untouched
        }
        if (JSON.stringify(bufferValue) !== JSON.stringify(config.model ?? "")) {
            setModelJsonText(JSON.stringify(config.model ?? "", null, 2))
        }
    }, [config.model, showModelJson, modelJsonText])

    // Claude permissions (Layer 1, Claude-only): the Claude harness's own permission knobs, kept in
    // the neutral `harness_kwargs.claude.permissions` bag. Shown in Advanced only for the Claude
    // harness; writes preserve any other harness_kwargs slices.
    const harnessKwargs = useMemo(
        () =>
            config.harness_kwargs && typeof config.harness_kwargs === "object"
                ? (config.harness_kwargs as Record<string, unknown>)
                : {},
        [config.harness_kwargs],
    )
    const claudePermissions = useMemo(() => {
        const claude =
            harnessKwargs.claude && typeof harnessKwargs.claude === "object"
                ? (harnessKwargs.claude as Record<string, unknown>)
                : undefined
        const perms = claude?.permissions
        return perms && typeof perms === "object" ? (perms as Record<string, unknown>) : null
    }, [harnessKwargs])
    const setClaudePermissions = useCallback(
        (next: Record<string, unknown>) => {
            const claude =
                harnessKwargs.claude && typeof harnessKwargs.claude === "object"
                    ? (harnessKwargs.claude as Record<string, unknown>)
                    : {}
            setField("harness_kwargs", {
                ...harnessKwargs,
                claude: {...claude, permissions: next},
            })
        },
        [harnessKwargs, setField],
    )

    // Tools live as a flat array on the agent config (the same tool-object shape the
    // prompt control uses, so the backend resolver parses them identically).
    const tools = useMemo(
        () => (Array.isArray(config.tools) ? (config.tools as unknown[]) : []),
        [config.tools],
    )
    const setTools = useCallback((next: unknown[]) => setField("tools", next), [setField])

    const handleAddTool = useCallback(
        (tool: ToolObj, meta?: ToolSelectionMeta) => {
            const next =
                meta && tool && typeof tool === "object" && !Array.isArray(tool)
                    ? {
                          ...(tool as Record<string, unknown>),
                          agenta_metadata: {
                              ...(((tool as Record<string, unknown>).agenta_metadata as
                                  | Record<string, unknown>
                                  | undefined) ?? {}),
                              ...meta,
                          },
                      }
                    : tool
            // A custom (inline function) tool starts blank — edit it in a create drawer and only
            // append on Save, so a half-filled tool never lands in the config. Builtin/gateway
            // tools arrive complete (and gateway is multi-select), so add those straight away.
            if (meta?.source === "custom") {
                openCreate("tool", next as Record<string, unknown>, "form")
                return
            }
            setTools([...tools, next])
        },
        [tools, setTools, openCreate],
    )

    // Append a `type:"reference"` tool for a workflow chosen in the reference drawer (#4860),
    // auto-deriving its model-facing input schema from the workflow's latest revision. The axis
    // (variant/environment), pinned version, and environment come from the drawer's payload.
    const handleAddWorkflowReference = useCallback(
        async (payload: WorkflowReferencePayload) => {
            // Don't reference the same workflow twice.
            if (tools.some((t) => toolReferenceSlug(t) === payload.slug)) return
            const wf = workflowReference?.workflows.find((w) => w.slug === payload.slug)
            let inputSchema: Record<string, unknown> | null = null
            try {
                inputSchema = wf
                    ? ((await workflowReference?.resolveInputSchema(wf)) ?? null)
                    : null
            } catch {
                inputSchema = null
            }
            handleAddTool({
                type: "reference",
                ref_by: payload.refBy,
                slug: payload.slug,
                ...(payload.refBy === "variant" && payload.version
                    ? {version: payload.version}
                    : {}),
                ...(payload.refBy === "environment" && payload.environment
                    ? {environment: payload.environment}
                    : {}),
                name: payload.slug,
                description: wf?.description ?? wf?.name ?? "",
                input_schema: inputSchema ?? {type: "object", properties: {}},
            } as ToolObj)
        },
        [tools, workflowReference, handleAddTool],
    )

    const handleToolDelete = useCallback(
        (index: number) => setTools(tools.filter((_, i) => i !== index)),
        [tools, setTools],
    )

    const handleRemoveToolByName = useCallback(
        (name: string) => setTools(tools.filter((tool) => toolName(tool) !== name)),
        [tools, setTools],
    )

    const handleRemoveBuiltinTool = useCallback(
        (toolToRemove: ToolObj) => {
            let removed = false
            const updated = tools.filter((tool) => {
                if (removed) return true
                if (!isBuiltinPayloadMatch(tool, toolToRemove)) return true
                removed = true
                return false
            })
            if (removed) setTools(updated)
        },
        [tools, setTools],
    )

    const selectedToolNames = useMemo(
        () => new Set(tools.map(toolName).filter((n): n is string => Boolean(n))),
        [tools],
    )

    // MCP servers are a sibling of tools: a flat array on the agent config. Each entry is the
    // open McpServer shape (name + stdio command/args/env or remote url, secret names), edited
    // as JSON the backend resolver parses identically to `tools`.
    const mcpServers = useMemo(
        () => (Array.isArray(config.mcp_servers) ? (config.mcp_servers as unknown[]) : []),
        [config.mcp_servers],
    )
    const setMcpServers = useCallback(
        (next: unknown[]) => setField("mcp_servers", next),
        [setField],
    )
    const handleAddMcpServer = useCallback(() => {
        openCreate("mcp", {name: "", transport: "stdio", command: "", args: []}, "form")
    }, [openCreate])
    const handleMcpServerDelete = useCallback(
        (index: number) => setMcpServers(mcpServers.filter((_, i) => i !== index)),
        [mcpServers, setMcpServers],
    )

    // Skills are a sibling of tools/MCP: a flat array on the agent config. Each entry is an inline
    // SKILL.md package (name + description + body + files + flags) or an `@ag.embed` reference the
    // backend inlines — the `skill_config` catalog type (SkillConfigSchema in the SDK).
    const skills = useMemo(
        () => (Array.isArray(config.skills) ? (config.skills as unknown[]) : []),
        [config.skills],
    )
    const setSkills = useCallback((next: unknown[]) => setField("skills", next), [setField])
    const handleAddSkill = useCallback(() => {
        openCreate("skill", {name: "", description: "", body: ""}, "form")
    }, [openCreate])
    const handleSkillDelete = useCallback(
        (index: number) => setSkills(skills.filter((_, i) => i !== index)),
        [skills, setSkills],
    )

    // Apply the drawer's draft to the config: append (create) or replace at index (edit).
    const commitDraft = useCallback(() => {
        if (!editing) return
        if (editing.kind === "tool") {
            const next = [...tools]
            if (editing.mode === "create") next.push(draft)
            else next[editing.index] = draft
            setTools(next)
        } else if (editing.kind === "mcp") {
            const next = [...mcpServers]
            if (editing.mode === "create") next.push(draft)
            else next[editing.index] = draft
            setMcpServers(next)
        } else {
            const next = [...skills]
            if (editing.mode === "create") next.push(draft)
            else next[editing.index] = draft
            setSkills(next)
        }
        setEditing(null)
    }, [editing, draft, tools, mcpServers, skills, setTools, setMcpServers, setSkills])

    // Block Save until the draft has the minimum it needs to be a valid item (a name). `@ag.embed`
    // skill references carry no name and are always valid (they round-trip as-is).
    // JSON-view parse validity from the open drawer's JsonObjectEditor; blocks Save while the
    // raw JSON is invalid. The editor keeps invalid text local and stops emitting onChange, so
    // without this Save would silently commit the last valid draft.
    const [jsonInvalid, setJsonInvalid] = useState(false)
    // Reset when the open item changes — each editor is keyed/remounts and starts valid.
    useEffect(() => {
        setJsonInvalid(false)
    }, [editing])

    const draftInvalid = useMemo(() => {
        if (!editing) return true
        if (editing.kind === "mcp") {
            // A server needs a launch target too, not just a name: stdio → command, http → url.
            const name = String(draft.name ?? "").trim()
            const transport = draft.transport === "http" ? "http" : "stdio"
            const target =
                transport === "http"
                    ? String(draft.url ?? "").trim()
                    : String(draft.command ?? "").trim()
            return !name || !target
        }
        if (editing.kind === "skill")
            return !isEmbedRefSkill(draft) && !String(draft.name ?? "").trim()
        const fn = draft.function as Record<string, unknown> | undefined
        if (fn && typeof fn === "object") return !String(fn.name ?? "").trim()
        return false
    }, [editing, draft])

    // ``agents_md`` is the catalog-schema field; ``instructions`` is read as a fallback so an
    // already-stored agent config (the legacy key) still populates the editor.
    const agentsMd =
        (config.agents_md as string | null | undefined) ??
        (config.instructions as string | null | undefined) ??
        null

    const modelSummary =
        [enumLabel(props.harness, config.harness), enumLabel(props.model, modelId)]
            .filter(Boolean)
            .join(" · ") || undefined

    const hasInstructions = Boolean(props.agents_md)
    const hasModelOrHarness = Boolean(props.model || props.harness)
    const hasTools = Boolean(props.tools)
    const hasMcp = Boolean(props.mcp_servers)
    const hasSkills = Boolean(props.skills)
    const hasClaudePermissions = harnessValue === "claude"
    const hasAdvanced = Boolean(
        props.sandbox ||
        props.permission_policy ||
        props.sandbox_permission ||
        hasClaudePermissions,
    )

    // Shared props for the tool picker, so the in-body popover and the header quick-add trigger
    // drive the same add flow.
    const toolSelectorProps = {
        onAddTool: handleAddTool,
        onRemoveTool: handleRemoveToolByName,
        onRemoveBuiltinTool: handleRemoveBuiltinTool,
        selectedToolNames,
        selectedTools: tools as ToolObj[],
        existingToolCount: tools.length,
        gatewayTools,
        onReferenceWorkflow: workflowReference?.enabled
            ? () => setReferenceSelectorOpen(true)
            : undefined,
    }

    // Workflows not yet referenced as a tool — the pool the selector drawer offers.
    const referenceableWorkflows = useMemo(() => {
        const referenced = new Set(
            tools.map((t) => toolReferenceSlug(t)).filter((s): s is string => Boolean(s)),
        )
        return (workflowReference?.workflows ?? []).filter((w) => !referenced.has(w.slug))
    }, [tools, workflowReference])

    // A compact "+" affordance for a section header, so an item can be added without first
    // expanding the section. Rendered in the header's `extra` slot (which stops propagation, so it
    // never toggles the section).
    const headerAddButton = (label: string, onClick: () => void) => (
        <Tooltip title={label}>
            <Button type="text" icon={<Plus size={16} />} onClick={onClick} aria-label={label} />
        </Tooltip>
    )

    // Each config section as a descriptor, so it can be rendered in any layout (accordion /
    // tabs / cards) without duplicating the content. Schema-gated, like before.
    const sections = [
        hasModelOrHarness && {
            key: "model-harness",
            icon: <Cpu size={16} />,
            title: "Model & harness",
            summary: modelSummary,
            defaultOpen: true,
            content: (
                <>
                    {props.harness && (
                        <HarnessSelectControl
                            schema={props.harness}
                            label="Harness"
                            value={(config.harness as string | null) ?? null}
                            onChange={(v) => setField("harness", v)}
                            withTooltip={withTooltip}
                            disabled={disabled}
                        />
                    )}
                    {props.model && (
                        <>
                            {/* Unified provider + model picker. When the agent's `/inspect`
                                publishes a harness-filtered model list we render from it (selecting
                                a model sets both the model id and its provider). Otherwise we fall
                                back to the schema's full catalog picker. */}
                            {hasInspectModels ? (
                                <LabeledField
                                    label="Model"
                                    description="Filtered to the models this harness can reach. Selecting a model also sets its provider."
                                    withTooltip={withTooltip}
                                >
                                    <SelectLLMProviderBase
                                        showGroup
                                        options={modelGroups}
                                        value={modelId ?? undefined}
                                        onChange={(v) =>
                                            writeModel({modelId: (v as string) ?? null})
                                        }
                                        disabled={disabled}
                                        placeholder="Select a model…"
                                        className="w-full"
                                    />
                                </LabeledField>
                            ) : (
                                <GroupedChoiceControl
                                    schema={props.model}
                                    label="Model"
                                    value={modelId}
                                    onChange={(v) => writeModel({modelId: v})}
                                    withTooltip={withTooltip}
                                    disabled={disabled}
                                />
                            )}

                            {/* Authentication (credential source) + the chosen connection, grouped
                                as an inset card so the credential fields read as a sub-section, not
                                peers of Harness/Model. Agenta-managed uses a stored vault
                                connection; self-managed means the harness brings its own login. */}
                            <div className="mt-1 flex flex-col gap-2 rounded-lg border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] p-3">
                                <Typography.Text className="text-[11px] font-medium uppercase tracking-wide text-[var(--ag-c-97A4B0,#97a4b0)]">
                                    Authentication
                                </Typography.Text>

                                {/* Credential source as selectable radio cards (not a segmented
                                    tab): each option carries an explainer so the choice is
                                    self-describing. The selected card is marked by the brand-primary
                                    border + filled radio dot + primary title — token-based so it
                                    reads in light and dark. */}
                                {modeOptions.map((m) => {
                                    const selected = connection.mode === m
                                    const title = m === "agenta" ? "Agenta-managed" : "Self-managed"
                                    const desc =
                                        m === "agenta"
                                            ? "Agenta supplies the credential from this project's vault — the default provider key, or a named connection you pick below."
                                            : "The harness signs in itself (an environment variable or a prior OAuth login). Agenta injects no credential."
                                    return (
                                        <button
                                            key={m}
                                            type="button"
                                            role="radio"
                                            aria-checked={selected}
                                            disabled={disabled}
                                            onClick={() => writeModel({mode: m})}
                                            className={cn(
                                                "flex w-full items-start gap-2.5 rounded-lg border border-solid p-2.5 text-left transition-colors",
                                                disabled
                                                    ? "cursor-not-allowed opacity-60"
                                                    : "cursor-pointer",
                                                selected
                                                    ? "border-[var(--ant-color-primary)] bg-[var(--ant-color-fill-secondary)]"
                                                    : "border-[var(--ant-color-border)] bg-[var(--ant-color-fill-quaternary)] hover:border-[var(--ant-color-text-quaternary)] hover:bg-[var(--ant-color-fill-tertiary)]",
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-solid",
                                                    selected
                                                        ? "border-[var(--ant-color-primary)]"
                                                        : "border-[var(--ant-color-text-tertiary)]",
                                                )}
                                            >
                                                {selected && (
                                                    <span className="h-2 w-2 rounded-full bg-[var(--ant-color-primary)]" />
                                                )}
                                            </span>
                                            <span className="flex flex-col gap-0.5">
                                                <Typography.Text
                                                    className={cn(
                                                        "text-xs font-medium leading-none",
                                                        selected &&
                                                            "!text-[var(--ant-color-primary-text)]",
                                                    )}
                                                >
                                                    {title}
                                                </Typography.Text>
                                                <Typography.Text
                                                    type="secondary"
                                                    className="text-[11px] leading-snug"
                                                >
                                                    {desc}
                                                </Typography.Text>
                                            </span>
                                        </button>
                                    )
                                })}

                                {connection.mode === "agenta" && (
                                    <LabeledField
                                        label="Connection"
                                        description="Which stored connection supplies the credential. Project default uses the project's provider key."
                                        withTooltip
                                    >
                                        <Select<string>
                                            value={connection.slug ?? "__default__"}
                                            onChange={(v) =>
                                                writeModel({
                                                    slug: v === "__default__" ? null : (v ?? null),
                                                })
                                            }
                                            options={[
                                                {value: "__default__", label: "Project default"},
                                                ...connectionOptions.map((o) => ({
                                                    value: o.value,
                                                    label: o.label,
                                                })),
                                            ]}
                                            disabled={disabled}
                                            className="w-full"
                                            showSearch
                                            optionFilterProp="label"
                                        />
                                    </LabeledField>
                                )}

                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={showModelJson}
                                        onChange={handleToggleModelJson}
                                        disabled={disabled}
                                    />
                                    <Typography.Text className="text-xs">
                                        Edit as JSON
                                    </Typography.Text>
                                </div>
                                {showModelJson && (
                                    <CodeEditor
                                        value={modelJsonText}
                                        onChange={handleModelJsonChange}
                                        language="json"
                                        disabled={disabled}
                                    />
                                )}
                            </div>
                        </>
                    )}
                </>
            ),
        },
        hasInstructions && {
            key: "instructions",
            icon: <FileText size={16} />,
            title: (
                <span className="inline-flex items-center gap-2">
                    Instructions
                    <Tag className="m-0 font-normal" bordered>
                        AGENTS.md
                    </Tag>
                </span>
            ),
            defaultOpen: true,
            content: (
                <MarkdownEditor
                    value={agentsMd ?? ""}
                    onChange={(v) => setField("agents_md", v)}
                    placeholder={"# Role\n\nDescribe what the agent does and how it should behave…"}
                    disabled={disabled}
                    filename="AGENTS.md"
                />
            ),
        },
        hasTools && {
            key: "tools",
            icon: <Wrench size={16} />,
            title: "Tools",
            summary: countSummary(tools.length, "tool"),
            extra: !disabled ? (
                <ToolSelectorPopover
                    {...toolSelectorProps}
                    trigger={
                        <Tooltip title="Add tool">
                            <Button
                                type="text"
                                icon={<Plus size={16} />}
                                disabled={disabled}
                                aria-label="Add tool"
                            />
                        </Tooltip>
                    }
                />
            ) : undefined,
            defaultOpen: true,
            content: (
                <>
                    {tools.length > 0 && (
                        <div className="flex flex-col gap-2">
                            {tools.map((tool, index) => (
                                <ItemRow
                                    key={`tool-${index}`}
                                    descriptor={describeTool(tool)}
                                    onEdit={() =>
                                        openEdit(
                                            "tool",
                                            index,
                                            tool,
                                            isFunctionTool(tool) ? "form" : "json",
                                        )
                                    }
                                    onRemove={() => {
                                        handleToolDelete(index)
                                        closeEditor()
                                    }}
                                    disabled={disabled}
                                />
                            ))}
                        </div>
                    )}
                    {!disabled && (
                        <div>
                            <ToolSelectorPopover {...toolSelectorProps} />
                        </div>
                    )}
                </>
            ),
        },
        hasMcp && {
            key: "mcp",
            icon: <Plugs size={16} />,
            title: "MCP servers",
            summary: countSummary(mcpServers.length, "server"),
            extra: !disabled ? headerAddButton("Add MCP server", handleAddMcpServer) : undefined,
            defaultOpen: mcpServers.length > 0,
            content: (
                <>
                    {mcpServers.length > 0 && (
                        <div className="flex flex-col gap-2">
                            {mcpServers.map((server, index) => (
                                <ItemRow
                                    key={`mcp-${index}`}
                                    descriptor={describeMcp(server)}
                                    onEdit={() => openEdit("mcp", index, server, "form")}
                                    onRemove={() => {
                                        handleMcpServerDelete(index)
                                        closeEditor()
                                    }}
                                    disabled={disabled}
                                />
                            ))}
                        </div>
                    )}
                    {!disabled && (
                        <div>
                            <Button icon={<Plus size={14} />} onClick={handleAddMcpServer}>
                                Add MCP server
                            </Button>
                        </div>
                    )}
                </>
            ),
        },
        hasSkills && {
            key: "skills",
            icon: <GraduationCap size={16} />,
            title: "Skills",
            summary: countSummary(skills.length, "skill"),
            extra: !disabled ? headerAddButton("Add skill", handleAddSkill) : undefined,
            defaultOpen: skills.length > 0,
            content: (
                <>
                    {skills.length > 0 && (
                        <div className="flex flex-col gap-2">
                            {skills.map((skill, index) => (
                                <ItemRow
                                    key={`skill-${index}`}
                                    descriptor={describeSkill(skill)}
                                    onEdit={() =>
                                        openEdit(
                                            "skill",
                                            index,
                                            skill,
                                            isEmbedRefSkill(skill) ? "json" : "form",
                                        )
                                    }
                                    onRemove={() => {
                                        handleSkillDelete(index)
                                        closeEditor()
                                    }}
                                    // Platform skills (`_agenta.*`) are read-only: no remove, and
                                    // the drawer opens disabled (see the skill drawer below).
                                    disabled={disabled || isPlatformSkill(skill)}
                                />
                            ))}
                        </div>
                    )}
                    {!disabled && (
                        <div>
                            <Button icon={<Plus size={14} />} onClick={handleAddSkill}>
                                Add skill
                            </Button>
                        </div>
                    )}
                </>
            ),
        },
        hasAdvanced && {
            key: "advanced",
            icon: <SlidersHorizontal size={16} />,
            title: "Advanced",
            defaultOpen: false,
            content: (
                <>
                    {props.sandbox && (
                        <EnumSelectControl
                            schema={props.sandbox}
                            label="Sandbox"
                            value={(config.sandbox as string | null) ?? null}
                            onChange={(v) => setField("sandbox", v)}
                            withTooltip={withTooltip}
                            disabled={disabled}
                        />
                    )}
                    {props.permission_policy && !isPiHarness && (
                        <EnumSelectControl
                            schema={props.permission_policy}
                            label="Permission policy"
                            value={(config.permission_policy as string | null) ?? null}
                            onChange={(v) => setField("permission_policy", v)}
                            withTooltip={withTooltip}
                            disabled={disabled}
                        />
                    )}
                    {props.sandbox_permission ? (
                        <SandboxPermissionControl
                            value={
                                (config.sandbox_permission as Record<string, unknown> | null) ??
                                null
                            }
                            onChange={(v) => setField("sandbox_permission", v)}
                            disabled={disabled}
                        />
                    ) : null}
                    {hasClaudePermissions ? (
                        <div className="flex flex-col gap-2 border-0 border-t border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] pt-3">
                            <Typography.Text className="text-xs font-medium">
                                Claude permissions
                            </Typography.Text>
                            <ClaudePermissionsControl
                                value={claudePermissions}
                                onChange={setClaudePermissions}
                                disabled={disabled}
                            />
                        </div>
                    ) : null}
                </>
            ),
        },
    ].filter(Boolean) as {
        key: string
        icon: React.ReactNode
        title: React.ReactNode
        summary?: React.ReactNode
        extra?: React.ReactNode
        defaultOpen?: boolean
        content: React.ReactNode
    }[]

    return (
        <div className={cn("flex flex-col", className)}>
            {sections.length === 0 ? (
                <Typography.Text type="secondary" className="text-xs">
                    No agent configuration fields are available for this schema.
                </Typography.Text>
            ) : layout === "tabs" ? (
                <Tabs
                    items={sections.map((s) => ({
                        key: s.key,
                        label: (
                            <span className="inline-flex items-center gap-1.5">
                                {s.icon}
                                {s.title}
                            </span>
                        ),
                        children: <div className="flex flex-col gap-3 pt-1">{s.content}</div>,
                    }))}
                />
            ) : layout === "cards" ? (
                <div className="flex flex-col gap-3 pt-1">
                    {sections.map((s) => (
                        <ConfigAccordionSection
                            key={s.key}
                            icon={s.icon}
                            title={s.title}
                            summary={s.summary}
                            extra={s.extra}
                            collapsible={false}
                            noDivider
                            className="rounded border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] px-3"
                        >
                            {s.content}
                        </ConfigAccordionSection>
                    ))}
                </div>
            ) : (
                sections.map((s, index) => (
                    <ConfigAccordionSection
                        key={s.key}
                        icon={s.icon}
                        title={s.title}
                        summary={s.summary}
                        extra={s.extra}
                        defaultOpen={s.defaultOpen}
                        noDivider={index === sections.length - 1}
                    >
                        {s.content}
                    </ConfigAccordionSection>
                ))
            )}

            {editing && editing.kind === "tool" && (
                <ConfigItemDrawer
                    open
                    mode={editing.mode}
                    icon={<Wrench size={16} />}
                    title={
                        describeTool(draft).name && describeTool(draft).name !== "Tool"
                            ? describeTool(draft).name
                            : "New tool"
                    }
                    badge={{
                        text: describeTool(draft).typeLabel,
                        color: describeTool(draft).typeColor,
                    }}
                    subtitle={describeTool(draft).subtitle}
                    footerNote="Changes apply to this agent configuration"
                    view={drawerView}
                    onViewChange={setDrawerView}
                    onCancel={closeEditor}
                    onSave={commitDraft}
                    saveDisabled={draftInvalid || (drawerView === "json" && jsonInvalid)}
                    jsonOnly={!isFunctionTool(draft)}
                    disabled={disabled}
                    form={
                        <ToolFormView
                            key={`tool-form-${editing.mode}-${editing.index}`}
                            value={draft}
                            onChange={(v) => setDraft(v as Record<string, unknown>)}
                            disabled={disabled}
                        />
                    }
                    json={
                        <JsonObjectEditor
                            key={`tool-json-${editing.mode}-${editing.index}`}
                            value={draft}
                            onChange={(v) => setDraft(v as Record<string, unknown>)}
                            onValidityChange={(valid) => setJsonInvalid(!valid)}
                            disabled={disabled}
                        />
                    }
                />
            )}

            {editing && editing.kind === "mcp" && (
                <ConfigItemDrawer
                    open
                    mode={editing.mode}
                    icon={<Plugs size={16} />}
                    title={String(draft.name ?? "").trim() || "New MCP server"}
                    badge={{
                        text: describeMcp(draft).typeLabel,
                        color: describeMcp(draft).typeColor,
                    }}
                    subtitle={describeMcp(draft).subtitle}
                    footerNote="Changes apply to this agent configuration"
                    view={drawerView}
                    onViewChange={setDrawerView}
                    onCancel={closeEditor}
                    onSave={commitDraft}
                    saveDisabled={draftInvalid || (drawerView === "json" && jsonInvalid)}
                    disabled={disabled}
                    form={
                        <McpServerFormView
                            key={`mcp-form-${editing.mode}-${editing.index}`}
                            value={draft}
                            onChange={(v) => setDraft(v)}
                            disabled={disabled}
                        />
                    }
                    json={
                        <JsonObjectEditor
                            key={`mcp-json-${editing.mode}-${editing.index}`}
                            value={draft}
                            onChange={(v) => setDraft(v as Record<string, unknown>)}
                            onValidityChange={(valid) => setJsonInvalid(!valid)}
                            disabled={disabled}
                        />
                    }
                />
            )}

            {editing && editing.kind === "skill" && (
                <ConfigItemDrawer
                    open
                    mode={editing.mode}
                    icon={<GraduationCap size={16} />}
                    title={
                        isEmbedRefSkill(draft)
                            ? "Skill reference"
                            : String(draft.name ?? "").trim() || "New skill"
                    }
                    badge={{
                        text: describeSkill(draft).typeLabel,
                        color: describeSkill(draft).typeColor,
                    }}
                    subtitle={describeSkill(draft).subtitle}
                    footerNote="Changes apply to this agent configuration"
                    // Wider than the default 600 — the skill drawer is two-pane (Files + editor).
                    width={760}
                    view={drawerView}
                    onViewChange={setDrawerView}
                    onCancel={closeEditor}
                    onSave={commitDraft}
                    saveDisabled={draftInvalid || (drawerView === "json" && jsonInvalid)}
                    jsonOnly={isEmbedRefSkill(draft)}
                    // Platform skills (`_agenta.*`) are read-only — view their JSON but can't edit.
                    disabled={disabled || isPlatformSkill(draft)}
                    form={
                        <SkillFormView
                            key={`skill-form-${editing.mode}-${editing.index}`}
                            value={draft}
                            onChange={(v) => setDraft(v)}
                            disabled={disabled || isPlatformSkill(draft)}
                        />
                    }
                    json={
                        <JsonObjectEditor
                            key={`skill-json-${editing.mode}-${editing.index}`}
                            value={draft}
                            onChange={(v) => setDraft(v as Record<string, unknown>)}
                            onValidityChange={(valid) => setJsonInvalid(!valid)}
                            disabled={disabled || isPlatformSkill(draft)}
                        />
                    }
                />
            )}

            {workflowReference?.enabled && (
                <WorkflowReferenceSelector
                    open={referenceSelectorOpen}
                    onClose={() => setReferenceSelectorOpen(false)}
                    workflows={referenceableWorkflows}
                    bridge={workflowReference}
                    onSelect={(payload) => {
                        void handleAddWorkflowReference(payload)
                        setReferenceSelectorOpen(false)
                    }}
                />
            )}
        </div>
    )
}
