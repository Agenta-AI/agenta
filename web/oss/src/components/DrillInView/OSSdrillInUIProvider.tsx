/**
 * OSSdrillInUIProvider
 *
 * Provides OSS-specific UI components to the DrillInView package components
 * via the DrillInUIProvider context.
 *
 * Most UI components (Editor, ChatMessage, FieldHeader, etc.) are now imported
 * directly from @agenta/ui in the entities package. This provider only needs
 * to inject truly app-specific components that have OSS-level integrations.
 *
 * @example
 * ```tsx
 * // Wrap your app or feature root with this provider
 * function App() {
 *   return (
 *     <OSSdrillInUIProvider>
 *       <YourContent />
 *     </OSSdrillInUIProvider>
 *   )
 * }
 * ```
 */

import {useMemo, type ReactNode} from "react"

import {appEnvironmentsQueryAtomFamily} from "@agenta/entities/environment"
import {
    buildToolSlug,
    fetchToolActionDetail,
    toolCatalogDrawerOpenAtom,
    useToolCatalogActions,
    useToolConnectionsQuery,
    useToolIntegrationDetail,
} from "@agenta/entities/gatewayTool"
import type {RunnablePort} from "@agenta/entities/shared"
import {
    discardLocalServerDataAtom,
    evaluatorTemplatesMapAtom,
    nonArchivedWorkflowsAtom,
    parseWorkflowKeyFromUri,
    queryWorkflowRevisionsByWorkflow,
    resolveInputSchema as resolveWorkflowInputSchema,
    resolveOutputSchema as resolveWorkflowOutputSchema,
    resolveParameters,
    resolveScript,
    retrieveWorkflowRevision,
    workflowLocalServerDataAtomFamily,
    workflowMolecule,
    workflowsListQueryStateAtom,
    type Workflow,
    type WorkflowType,
} from "@agenta/entities/workflow"
import {
    DrillInUIProvider,
    type GatewayToolsBridge,
    type WorkflowConfigPart,
    type WorkflowConfigPayload,
    type WorkflowReferenceBridge,
    type WorkflowReferenceUI,
    type WorkflowReferenceType,
    type WorkflowRevisionUI,
    type WorkflowEnvironmentUI,
} from "@agenta/entity-ui/drill-in"
import {projectIdAtom} from "@agenta/shared/state"
import {KNOWN_ENVELOPE_SLOTS} from "@agenta/shared/utils"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {getDefaultStore, useAtomValue, useSetAtom, useStore} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {useLLMProviderConfig} from "@/oss/hooks/useLLMProviderConfig"
import {isToolsEnabled} from "@/oss/lib/helpers/isEE"
import {isDemo} from "@/oss/lib/helpers/utils"

interface OSSdrillInUIProviderProps {
    children: ReactNode
}

function useGatewayToolsIntegrationInfo(integrationKey: string) {
    const {integration, isLoading} = useToolIntegrationDetail(integrationKey)
    return {
        name: integration?.name,
        logo: integration?.logo,
        isLoading,
    }
}

function useGatewayToolsCatalogActions(integrationKey: string) {
    const res = useToolCatalogActions(integrationKey)
    return {
        actions: res.actions.map((action) => ({key: action.key, name: action.name})),
        total: res.total,
        isLoading: res.isLoading,
        isFetchingNextPage: res.isFetchingNextPage,
        hasNextPage: res.hasNextPage,
        requestMore: res.requestMore,
        setSearch: res.setSearch,
        prefetchThreshold: res.prefetchThreshold,
    }
}

// A workflow's revisions, fetched on demand when one is selected in the reference drawer (the
// variant-axis version picker). Keyed by workflow id; the project is singular in scope.
const workflowRevisionsQueryAtomFamily = atomFamily((workflowId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["agentWorkflowRevisions", workflowId, projectId],
            queryFn: () => queryWorkflowRevisionsByWorkflow(workflowId, projectId as string),
            enabled: Boolean(workflowId) && Boolean(projectId),
            staleTime: 60_000,
        }
    }),
)

function useWorkflowRevisions(workflow: WorkflowReferenceUI | null): {
    revisions: WorkflowRevisionUI[]
    isLoading: boolean
} {
    const res = useAtomValue(workflowRevisionsQueryAtomFamily(workflow?.id ?? ""))
    const revisions = useMemo<WorkflowRevisionUI[]>(() => {
        const list = (res.data?.workflow_revisions ?? []) as Record<string, unknown>[]
        return list
            .map((r) => ({
                version: r.version != null ? String(r.version) : "",
                label: typeof r.message === "string" ? (r.message as string) : undefined,
            }))
            .filter((r) => Boolean(r.version) && Number(r.version) > 0)
            .sort((a, b) => Number(b.version) - Number(a.version))
    }, [res.data])
    return {revisions, isLoading: Boolean(res.isLoading)}
}

function useWorkflowEnvironments(workflow: WorkflowReferenceUI | null): {
    environments: WorkflowEnvironmentUI[]
    isLoading: boolean
} {
    const res = useAtomValue(appEnvironmentsQueryAtomFamily(workflow?.id ?? ""))
    const environments = useMemo<WorkflowEnvironmentUI[]>(
        () =>
            (res.data ?? [])
                .filter((env) => Boolean(env.slug))
                .map((env) => ({slug: env.slug, name: env.name || env.slug})),
        [res.data],
    )
    return {environments, isLoading: Boolean(res.isLoading)}
}

/**
 * Build the "reference a workflow as a tool" bridge (#4860): the project's workflows for the
 * picker plus resolvers that pull a chosen workflow's input schema (to pre-fill `input_schema`),
 * its revisions (variant axis) and its environments (environment axis). Not EE-gated, so it ships
 * in both the tools-enabled and tools-disabled trees.
 */
// Map the molecule's canonical workflow type down to the four the reference picker badges.
function toReferenceType(t: WorkflowType | null | undefined): WorkflowReferenceType | undefined {
    if (!t) return undefined
    if (t === "agent" || t === "chat" || t === "completion") return t
    return "custom"
}

// Classify a workflow by hydrating its fetched revision into the molecule and reading the SAME
// `workflowType` selector the playground uses — list items lack capability flags, so a naive URI
// parse mislabels agents (no prompt URI) and evaluators (heterogeneous code/match/llm kinds).
// Evaluators are labeled `evaluator` up front so they don't fall through to `custom`.
function classifyRevision(revision: Workflow): WorkflowReferenceType | undefined {
    if (revision.flags?.is_evaluator) return "evaluator"
    const store = getDefaultStore()
    const localId = `local-agent-ref-type-${revision.slug ?? revision.id ?? "wf"}`
    store.set(workflowLocalServerDataAtomFamily(localId), {...revision, id: localId})
    try {
        return toReferenceType(store.get(workflowMolecule.selectors.workflowType(localId)))
    } finally {
        store.set(discardLocalServerDataAtom, localId)
    }
}

interface ReferenceTypeInfo {
    type: WorkflowReferenceType | undefined
    /** For evaluators: the evaluator template key (from the revision URI), for a finer badge label. */
    evaluatorKey: string | null
}

// Resolve type + evaluator-key for a set of workflow slugs. Keyed by the sorted slug set so the batch
// is cached and only refetches when the set changes.
const referenceTypesQueryAtomFamily = atomFamily((slugsKey: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        const slugs = slugsKey ? slugsKey.split("\n") : []
        return {
            queryKey: ["agentReferenceWorkflowTypes", projectId, slugsKey],
            enabled: Boolean(projectId) && slugs.length > 0,
            staleTime: 300_000,
            queryFn: async () => {
                const pairs = await Promise.all(
                    slugs.map(async (slug): Promise<[string, ReferenceTypeInfo]> => {
                        try {
                            const revision = await retrieveWorkflowRevision({
                                projectId: projectId as string,
                                workflowRef: {slug},
                            })
                            if (!revision) return [slug, {type: undefined, evaluatorKey: null}]
                            return [
                                slug,
                                {
                                    type: classifyRevision(revision),
                                    evaluatorKey: revision.flags?.is_evaluator
                                        ? parseWorkflowKeyFromUri(revision.data?.uri)
                                        : null,
                                },
                            ]
                        } catch {
                            return [slug, {type: undefined, evaluatorKey: null}]
                        }
                    }),
                )
                return Object.fromEntries(pairs) as Record<string, ReferenceTypeInfo>
            },
        }
    }),
)

// Humanize an evaluator key as a fallback when the template catalog lacks a display name.
// e.g. "auto_exact_match" → "Exact Match".
function humanizeEvaluatorKey(key: string): string {
    return key
        .replace(/^(auto|human)_/, "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim()
}

function useWorkflowReferenceTypes(workflows: WorkflowReferenceUI[]): {
    typeBySlug: Record<string, WorkflowReferenceType | undefined>
    labelBySlug?: Record<string, string | undefined>
    loading: boolean
} {
    const slugsKey = useMemo(
        () =>
            workflows
                .map((w) => w.slug)
                .filter(Boolean)
                .sort()
                .join("\n"),
        [workflows],
    )
    const res = useAtomValue(referenceTypesQueryAtomFamily(slugsKey))
    // Evaluator template catalog (key → display name), for the evaluator sub-type badge.
    const evaluatorNames = useAtomValue(evaluatorTemplatesMapAtom)

    return useMemo(() => {
        const data = (res.data ?? {}) as Record<string, ReferenceTypeInfo>
        const typeBySlug: Record<string, WorkflowReferenceType | undefined> = {}
        const labelBySlug: Record<string, string | undefined> = {}
        for (const [slug, info] of Object.entries(data)) {
            typeBySlug[slug] = info.type
            if (info.evaluatorKey) {
                labelBySlug[slug] =
                    evaluatorNames.get(info.evaluatorKey) ?? humanizeEvaluatorKey(info.evaluatorKey)
            }
        }
        return {typeBySlug, labelBySlug, loading: Boolean(res.isLoading)}
    }, [res.data, res.isLoading, evaluatorNames])
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

// A prompt-shaped config (`{messages, llm_config, ...}`) or an agent-shaped one
// (`{instructions: {agents_md}, llm, tools, skills}` — agents nest instructions and keep tools/skills
// flat). Mirrors what the playground config panel edits.
function isPromptLike(v: Record<string, unknown>): boolean {
    return (
        Array.isArray(v.messages) ||
        isPlainRecord(v.llm_config) ||
        isPlainRecord(v.llm) ||
        typeof v.instructions === "string" ||
        isPlainRecord(v.instructions) ||
        Array.isArray(v.tools) ||
        Array.isArray(v.skills)
    )
}

// One prompt/agent config → Configuration parts: the prompt Messages, model, remaining model
// settings, tools, response_format, template_format, agent instructions/skills.
function promptConfigParts(prefix: string, cfg: Record<string, unknown>): WorkflowConfigPart[] {
    const parts: WorkflowConfigPart[] = []

    // Messages (System / User / …) are one grouped part, not a rail item per role.
    const messages = (Array.isArray(cfg.messages) ? cfg.messages : [])
        .filter(isPlainRecord)
        .map((m) => ({
            role: typeof m.role === "string" ? m.role : "message",
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content, null, 2),
        }))
        .filter((m) => m.content)
    if (messages.length) {
        parts.push({
            key: `${prefix}messages`,
            label: "Messages",
            kind: "messages",
            content: "",
            messages,
        })
    }

    // Model config lives under `llm_config` (prompts) or `llm` (agents).
    const llm = isPlainRecord(cfg.llm_config)
        ? cfg.llm_config
        : isPlainRecord(cfg.llm)
          ? cfg.llm
          : null
    if (llm) {
        if (typeof llm.model === "string" && llm.model) {
            parts.push({key: `${prefix}model`, label: "Model", kind: "text", content: llm.model})
        }
        const settings = {...llm}
        delete settings.model
        delete settings.tools
        delete settings.response_format
        if (Object.keys(settings).length) {
            parts.push({
                key: `${prefix}settings`,
                label: "Model settings",
                kind: "json",
                content: JSON.stringify(settings, null, 2),
            })
        }
        if (isPlainRecord(llm.response_format)) {
            parts.push({
                key: `${prefix}response_format`,
                label: "Response format",
                kind: "json",
                content: JSON.stringify(llm.response_format, null, 2),
            })
        }
    }

    if (typeof cfg.template_format === "string" && cfg.template_format) {
        parts.push({
            key: `${prefix}template_format`,
            label: "Template format",
            kind: "text",
            content: cfg.template_format,
        })
    }

    // Instructions: a plain string, or an agent's nested `{agents_md}` document.
    const instructionsText =
        typeof cfg.instructions === "string"
            ? cfg.instructions
            : isPlainRecord(cfg.instructions) && typeof cfg.instructions.agents_md === "string"
              ? cfg.instructions.agents_md
              : ""
    if (instructionsText.trim()) {
        parts.push({
            key: `${prefix}instructions`,
            label: "Instructions",
            kind: "text",
            content: instructionsText,
        })
    }

    // Tools live under `llm_config.tools` (prompts) or flat on the object (agents).
    const tools =
        llm && Array.isArray(llm.tools) && llm.tools.length
            ? (llm.tools as unknown[])
            : Array.isArray(cfg.tools)
              ? (cfg.tools as unknown[])
              : []
    if (tools.length) {
        parts.push({
            key: `${prefix}tools`,
            label: "Tools",
            kind: "json",
            content: JSON.stringify(tools, null, 2),
        })
    }

    if (Array.isArray(cfg.skills) && cfg.skills.length) {
        parts.push({
            key: `${prefix}skills`,
            label: "Skills",
            kind: "json",
            content: JSON.stringify(cfg.skills, null, 2),
        })
    }

    return parts
}

// Configuration parts from a revision's data: custom-workflow code, then each prompt/agent config
// (params may BE a prompt config or hold several under named keys). JSON fallback if unrecognized.
function buildConfigParts(data: unknown): WorkflowConfigPart[] {
    const parts: WorkflowConfigPart[] = []

    const script = resolveScript(data as Parameters<typeof resolveScript>[0])
    if (typeof script === "string" && script.trim()) {
        parts.push({
            key: "code",
            label: "Handler",
            kind: "code",
            content: script,
            language: "python",
        })
    }

    const params = resolveParameters(data as Parameters<typeof resolveParameters>[0])
    if (isPlainRecord(params)) {
        const entries: [string, Record<string, unknown>][] = isPromptLike(params)
            ? [["", params]]
            : Object.entries(params).filter(
                  (e): e is [string, Record<string, unknown>] =>
                      isPlainRecord(e[1]) && isPromptLike(e[1]),
              )
        const multiple = entries.length > 1
        for (const [key, cfg] of entries) {
            parts.push(...promptConfigParts(multiple && key ? `${key}-` : "", cfg))
        }
        if (parts.length === (script ? 1 : 0)) {
            parts.push({
                key: "config",
                label: "Config",
                kind: "json",
                content: JSON.stringify(params, null, 2),
            })
        }
    }

    return parts
}

// The structured-output JSON schema declared in a prompt's `llm_config.response_format`, if any.
function responseFormatSchema(data: unknown): Record<string, unknown> | null {
    const params = resolveParameters(data as Parameters<typeof resolveParameters>[0])
    if (!isPlainRecord(params)) return null
    const configs = isPromptLike(params) ? [params] : Object.values(params).filter(isPlainRecord)
    for (const cfg of configs) {
        const llm = isPlainRecord(cfg.llm_config) ? cfg.llm_config : null
        const rf = llm && isPlainRecord(llm.response_format) ? llm.response_format : null
        const js = rf && isPlainRecord(rf.json_schema) ? rf.json_schema : null
        const schema = js && isPlainRecord(js.schema) ? js.schema : null
        if (schema) return schema
    }
    return null
}

// The top-level input key a JSONPath placeholder addresses, or null if it's not an input.
// Mirrors `parseTemplateExpression`'s `$.` handling: `$.inputs.country`→"country",
// `$.country`→"country" (testcase-spread), `$.outputs.*`→null (runtime-resolved, not an input).
function jsonPathToInputKey(rawExpr: string): string | null {
    const expr = rawExpr.trim()
    if (!(expr === "$" || expr.startsWith("$.") || expr.startsWith("$["))) return null
    const tokens = expr
        .replace(/^\$\.?/, "")
        .split(/[.[\]'"]/)
        .filter(Boolean)
    if (tokens.length === 0) return null
    const first = tokens[0]
    if (KNOWN_ENVELOPE_SLOTS.has(first)) {
        return first === "inputs" ? (tokens[1] ?? null) : null
    }
    return first
}

// Recover input keys from JSONPath placeholders (`{{$.inputs.country}}`) that the SHARED template
// extractor drops for curly/jinja2 (its `$`-marker guard rejects them as mustache inheritance). We
// don't touch the shared extractor; this scoped scan makes the reference-drawer Schema section show
// those inputs. Mustache/plain vars are already handled by the molecule's inputPorts.
function extractJsonPathInputKeys(data: unknown): string[] {
    const params = resolveParameters(data as Parameters<typeof resolveParameters>[0])
    if (!isPlainRecord(params)) return []
    const configs = isPromptLike(params) ? [params] : Object.values(params).filter(isPlainRecord)
    const keys = new Set<string>()
    const re = /\{\{\s*(\$[^}]*?)\s*\}\}/g
    for (const cfg of configs) {
        const messages = Array.isArray(cfg.messages) ? cfg.messages : []
        for (const message of messages) {
            const content =
                isPlainRecord(message) && typeof message.content === "string" ? message.content : ""
            if (!content) continue
            let match: RegExpExecArray | null
            while ((match = re.exec(content)) !== null) {
                const key = jsonPathToInputKey(match[1])
                if (key) keys.add(key)
            }
        }
    }
    return [...keys]
}

// Merge extra input keys into a JSON schema (as string props), creating one if needed.
function mergeInputKeys(
    schema: Record<string, unknown> | null,
    keys: string[],
): Record<string, unknown> | null {
    if (keys.length === 0) return schema
    const base = isPlainRecord(schema) && isPlainRecord(schema.properties) ? schema : null
    const properties: Record<string, unknown> = base
        ? {...(base.properties as Record<string, unknown>)}
        : {}
    for (const key of keys) {
        if (!(key in properties)) properties[key] = {type: "string"}
    }
    return {
        type: "object",
        properties,
        required: base && Array.isArray(base.required) ? base.required : [],
    }
}

// Convert the molecule's derived input/output ports into a JSON schema for the Schema tree.
function portsToSchema(ports: RunnablePort[]): Record<string, unknown> | null {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const port of ports) {
        if (port.isFallback) continue
        properties[port.key] = isPlainRecord(port.schema)
            ? port.schema
            : {type: port.type || "string"}
        if (port.required) required.push(port.key)
    }
    if (Object.keys(properties).length === 0) return null
    return {type: "object", properties, required}
}

// Read a fetched revision's input/output ports through the workflow molecule — the SAME derivation
// the playground uses (declared schema → prompt template variables with nesting/JSONPath/sections).
// The revision is hydrated into the molecule under a transient `local-` id and discarded after.
function readWorkflowPorts(
    store: ReturnType<typeof useStore>,
    revision: Workflow,
): {inputPorts: RunnablePort[]; outputPorts: RunnablePort[]} {
    const localId = `local-agent-ref-${revision.slug ?? revision.id ?? "wf"}`
    store.set(workflowLocalServerDataAtomFamily(localId), {...revision, id: localId})
    try {
        return {
            inputPorts: store.get(workflowMolecule.selectors.inputPorts(localId)) as RunnablePort[],
            outputPorts: store.get(
                workflowMolecule.selectors.outputPorts(localId),
            ) as RunnablePort[],
        }
    } finally {
        store.set(discardLocalServerDataAtom, localId)
    }
}

function useWorkflowReferenceBridge(): WorkflowReferenceBridge {
    const projectId = useAtomValue(projectIdAtom)
    const workflows = useAtomValue(nonArchivedWorkflowsAtom)
    const workflowsLoading = useAtomValue(workflowsListQueryStateAtom).isPending
    const store = useStore()

    return useMemo<WorkflowReferenceBridge>(
        () => ({
            enabled: true,
            // All project workflows are referenceable (apps + evaluators + …), not just apps. Type
            // (incl. `evaluator`) is resolved per-slug via useWorkflowTypes.
            workflows: workflows
                .filter((w) => typeof w.slug === "string")
                .map((w) => ({
                    id: w.id,
                    slug: w.slug as string,
                    name: w.name ?? undefined,
                    description: w.description ?? undefined,
                    // type is resolved asynchronously via useWorkflowTypes (needs the revision URI).
                })),
            workflowsLoading,
            resolveInputSchema: async (workflow) => {
                if (!projectId || !workflow.slug) return null
                const revision = await retrieveWorkflowRevision({
                    projectId,
                    workflowRef: {slug: workflow.slug},
                })
                if (!revision?.data) return null
                // Declared input schema first (richest — carries descriptions), but still fold in
                // JSONPath inputs the shared curly/jinja2 extractor drops, so a mixed template that
                // has some declared props plus `{{$.inputs.*}}` doesn't publish an incomplete schema.
                const recoveredKeys = extractJsonPathInputKeys(revision.data)
                const declared = resolveWorkflowInputSchema(
                    revision.data as Parameters<typeof resolveWorkflowInputSchema>[0],
                )
                if (
                    isPlainRecord(declared?.properties) &&
                    Object.keys(declared!.properties).length > 0
                ) {
                    return mergeInputKeys(declared as Record<string, unknown>, recoveredKeys)
                }
                // Fallback: the prompt template's variables (the playground's own input-port
                // derivation — plain/dotted vars, mustache sections, nesting) + recovered JSONPath.
                const portSchema = portsToSchema(readWorkflowPorts(store, revision).inputPorts)
                return mergeInputKeys(portSchema, recoveredKeys)
            },
            resolveOutputSchema: async (workflow) => {
                if (!projectId || !workflow.slug) return null
                const revision = await retrieveWorkflowRevision({
                    projectId,
                    workflowRef: {slug: workflow.slug},
                })
                if (!revision?.data) return null
                const declared = resolveWorkflowOutputSchema(
                    revision.data as Parameters<typeof resolveWorkflowOutputSchema>[0],
                )
                if (
                    isPlainRecord(declared?.properties) &&
                    Object.keys(declared!.properties).length > 0
                ) {
                    return declared
                }
                // Fallback: the structured-output JSON schema from `response_format`.
                return responseFormatSchema(revision.data)
            },
            resolveConfigPayload: async (workflow): Promise<WorkflowConfigPayload | null> => {
                if (!projectId || !workflow.slug) return null
                const revision = await retrieveWorkflowRevision({
                    projectId,
                    workflowRef: {slug: workflow.slug},
                })
                if (!revision?.data) return null
                const parts = buildConfigParts(revision.data)
                return parts.length ? {parts} : null
            },
            useWorkflowRevisions,
            useWorkflowEnvironments,
            useWorkflowTypes: useWorkflowReferenceTypes,
        }),
        [workflows, workflowsLoading, projectId, store],
    )
}

/**
 * OSS-specific UI provider for DrillInView components.
 *
 * Injects:
 * - llmProviderConfig: vault secrets as extra option groups + "Add provider" footer
 * - EditorProvider / SharedEditor: rich text editor components
 * - gatewayTools: gateway tools data + actions bridge for the tool selector
 * - workflowReference: workflow-as-tool reference bridge for the tool selector
 *
 * All other UI components (ChatMessage, FieldHeader, etc.) are imported
 * directly from @agenta/ui in the entities package.
 */
export function OSSdrillInUIProvider({children}: OSSdrillInUIProviderProps) {
    const {llmProviderConfig, overlay: llmProviderOverlay} = useLLMProviderConfig()
    const toolsEnabled = isToolsEnabled()
    const workflowReference = useWorkflowReferenceBridge()
    // Deployment policy, never changes at runtime — not memoized. Gates the Provider credentials
    // section's "Use subscription" toggle (design.md D6, docs/design/connect-model-drawer).
    const deployment = {isCloud: isDemo()}

    if (!toolsEnabled) {
        return (
            <>
                <DrillInUIProvider
                    components={{
                        llmProviderConfig,
                        EditorProvider,
                        SharedEditor,
                        workflowReference,
                        deployment,
                    }}
                >
                    {children}
                </DrillInUIProvider>
                {llmProviderOverlay}
            </>
        )
    }

    return (
        <>
            <GatewayToolsEnabledProvider
                llmProviderConfig={llmProviderConfig}
                workflowReference={workflowReference}
                deployment={deployment}
            >
                {children}
            </GatewayToolsEnabledProvider>
            {llmProviderOverlay}
        </>
    )
}

function GatewayToolsEnabledProvider({
    children,
    llmProviderConfig,
    workflowReference,
    deployment,
}: {
    children: ReactNode
    llmProviderConfig: ReturnType<typeof useLLMProviderConfig>["llmProviderConfig"]
    workflowReference: WorkflowReferenceBridge
    deployment: {isCloud: boolean}
}) {
    const {connections, isLoading} = useToolConnectionsQuery()
    const setCatalogDrawerOpen = useSetAtom(toolCatalogDrawerOpenAtom)

    const gatewayTools = useMemo<GatewayToolsBridge>(
        () => ({
            enabled: true,
            connections: connections
                .filter((c) => typeof c.id === "string" && typeof c.slug === "string")
                .map((connection) => ({
                    id: connection.id as string,
                    slug: connection.slug as string,
                    name: connection.name ?? undefined,
                    integration_key: connection.integration_key,
                    provider_key: connection.provider_key,
                    flags: (connection.flags ?? undefined) as Record<string, unknown> | undefined,
                })),
            connectionsLoading: isLoading,
            onOpenCatalog: () => setCatalogDrawerOpen(true),
            useIntegrationInfo: (integrationKey: string) => {
                const info = useGatewayToolsIntegrationInfo(integrationKey)
                return {
                    name: info.name,
                    logo: info.logo ?? undefined,
                    isLoading: info.isLoading,
                }
            },
            useActions: useGatewayToolsCatalogActions,
            buildToolSlug,
            fetchActionDetail: async (provider: string, integration: string, action: string) => {
                const detail = await fetchToolActionDetail(provider, integration, action)
                const detailedAction =
                    detail.action && "schemas" in detail.action ? detail.action : null
                return {
                    action: {
                        description: detailedAction?.description ?? undefined,
                        schemas: detailedAction?.schemas
                            ? {inputs: detailedAction.schemas.inputs}
                            : undefined,
                    },
                }
            },
        }),
        [connections, isLoading, setCatalogDrawerOpen],
    )

    return (
        <DrillInUIProvider
            components={{
                llmProviderConfig,
                EditorProvider,
                SharedEditor,
                gatewayTools,
                workflowReference,
                deployment,
            }}
        >
            {children}
        </DrillInUIProvider>
    )
}

export default OSSdrillInUIProvider
