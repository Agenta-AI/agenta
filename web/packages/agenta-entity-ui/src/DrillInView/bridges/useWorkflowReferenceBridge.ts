/**
 * useWorkflowReferenceBridge
 *
 * The "reference a workflow as a tool" bridge (#4860) the agent tool picker reads off
 * DrillInUIContext: the project's workflows for the picker, plus resolvers that pull a chosen
 * workflow's input/output schema, config preview, revisions (variant axis) and environments
 * (environment axis).
 *
 * Package-level on purpose: every surface that renders the agent config panel needs it, and it
 * depends on nothing app-specific — only `@agenta/entities` state and the project id. The desktop
 * playground and the mobile Build pane both feed it into their own DrillInUIProvider.
 */
import {useMemo} from "react"

import type {RunnablePort} from "@agenta/entities/shared"
import {
    discardLocalServerDataAtom,
    nonArchivedWorkflowsAtom,
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
import {projectIdAtom} from "@agenta/shared/state"
import {KNOWN_ENVELOPE_SLOTS} from "@agenta/shared/utils"
import type {
    SubagentDetail,
    WorkflowConfigPart,
    WorkflowConfigPayload,
    WorkflowReferenceBridge,
    WorkflowReferenceCatalogEntry,
    WorkflowReferenceType,
} from "@agenta/ui/drill-in"
import {atom, getDefaultStore, useAtomValue, useSetAtom, useStore} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {describeSkill} from "../SchemaControls/agentTemplate/itemDescriptors"
import {connectionFromConfig, modelIdFromConfig} from "../SchemaControls/connectionUtils"
import {integrationPermissionSummary} from "../SchemaControls/integrationPolicy"
import {buildIntegrationRows} from "../SchemaControls/toolUtils"

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
    /** The workflow this revision belongs to. A row's icon is keyed by workflow id. */
    workflowId: string | null
    /** What the picker's rows show, read from the revision this query already fetched. */
    model: string | null
    provider: string | null
    /** Integration keys this agent has connected, e.g. ["github", "slack"]. */
    integrations: string[]
    /** This slug's revision fetch failed. Without it the agent silently leaves the picker. */
    failed?: boolean
}

/** The workflow a revision belongs to. */
function workflowIdOf(revision: Workflow): string | null {
    const id = (revision as unknown as Record<string, unknown>).workflow_id
    return typeof id === "string" && id ? id : null
}

/** The model, provider and connected apps of one workflow's latest revision. Every field is
 *  optional: a missing one means the workflow has none, never that the request failed. */
function summarizeRevision(revision: Workflow): {
    model: string | null
    provider: string | null
    integrations: string[]
} {
    const cfg = agentConfigOf(revision)
    if (!cfg) return {model: null, provider: null, integrations: []}
    // Agents nest the model under `llm`; prompt-shaped configs use `llm_config`.
    const llm = isPlainRecord(cfg.llm)
        ? cfg.llm
        : isPlainRecord(cfg.llm_config)
          ? cfg.llm_config
          : null
    const model = llm ? modelIdFromConfig(llm.model ?? llm) : null
    const provider = llm ? connectionFromConfig(llm).provider : null
    const tools = Array.isArray(cfg.tools) ? (cfg.tools as unknown[]) : []
    // The same parser the config panel uses, so picker and panel cannot disagree.
    const integrations = buildIntegrationRows(tools).map((row) => row.integration)
    return {model, provider, integrations}
}

/** The agent template inside a revision. NOT on `data` directly: `resolveParameters` unwraps the
 *  envelope and the config then sits flat or one level down under its own key. */
function agentConfigOf(revision: Workflow): Record<string, unknown> | null {
    const params = resolveParameters(revision.data as Parameters<typeof resolveParameters>[0])
    if (!isPlainRecord(params)) return null
    if (isPromptLike(params)) return params
    for (const value of Object.values(params)) {
        if (isPlainRecord(value) && isPromptLike(value)) return value
    }
    return null
}

const EMPTY_REFERENCE_INFO: ReferenceTypeInfo = {
    type: undefined,
    workflowId: null,
    model: null,
    provider: null,
    integrations: [],
}

// Type, binding and display summary for a set of slugs. One revision fetch per workflow serves
// all of it, keyed by the sorted set; nothing here may add a per-row request.
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
                            if (!revision) return [slug, EMPTY_REFERENCE_INFO]
                            return [
                                slug,
                                {
                                    type: classifyRevision(revision),
                                    workflowId: workflowIdOf(revision),
                                    ...summarizeRevision(revision),
                                },
                            ]
                        } catch {
                            // Recorded, never silently empty: an unmarked failure drops the agent
                            // from the picker and caches that absence for five minutes.
                            return [slug, {...EMPTY_REFERENCE_INFO, failed: true}]
                        }
                    }),
                )
                return Object.fromEntries(pairs) as Record<string, ReferenceTypeInfo>
            },
        }
    }),
)

// Lazy activation for the workflow-reference bridge. Referencing a workflow as an agent tool is
// the only consumer of the project-wide workflow list + evaluator catalog inside the always-mounted
// playground drill-in provider, and it's needed only once the user opens the reference picker or an
// existing reference is displayed. Until then these stay dormant, so a plain playground load doesn't
// fire the apps/evaluators list + evaluator catalog queries.
const workflowReferenceActivatedAtom = atom(false)
const activateWorkflowReferenceAtom = atom(null, (get, set) => {
    if (!get(workflowReferenceActivatedAtom)) set(workflowReferenceActivatedAtom, true)
})
const EMPTY_WORKFLOW_REFS: Workflow[] = []
const workflowReferenceWorkflowsAtom = atom((get) =>
    get(workflowReferenceActivatedAtom) ? get(nonArchivedWorkflowsAtom) : EMPTY_WORKFLOW_REFS,
)
const workflowReferenceLoadingAtom = atom((get) =>
    get(workflowReferenceActivatedAtom) ? get(workflowsListQueryStateAtom).isPending : false,
)

/** One subagent's detail, keyed by slug. Kept out of the picker's batch: 200 agents would carry
 *  megabytes of instruction text the picker never shows. */
const subagentDetailQueryAtomFamily = atomFamily((slug: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["agentSubagentDetail", projectId, slug],
            enabled: Boolean(projectId) && Boolean(slug),
            staleTime: 60_000,
            queryFn: async () => {
                const revision = await retrieveWorkflowRevision({
                    projectId: projectId as string,
                    workflowRef: {slug},
                })
                return revision ? subagentDetailOf(revision) : null
            },
        }
    }),
)

function useSubagentDetail(slug: string): {detail: SubagentDetail | null; loading: boolean} {
    const res = useAtomValue(subagentDetailQueryAtomFamily(slug))
    return {detail: (res.data as SubagentDetail | null) ?? null, loading: Boolean(res.isLoading)}
}

/** Words in a body of prose, for the instruction file's "Markdown, N words" line. */
function countWords(text: string): number {
    const words = text.trim().match(/\S+/g)
    return words ? words.length : 0
}

/** One subagent's configuration, read off its latest revision. */
function subagentDetailOf(revision: Workflow): SubagentDetail {
    const cfg = agentConfigOf(revision)
    const summary = summarizeRevision(revision)
    const tools = cfg && Array.isArray(cfg.tools) ? (cfg.tools as unknown[]) : []
    const integrations = buildIntegrationRows(tools).map((row) => ({
        key: row.integration,
        // The permission the agent granted this app, in the same words its own row uses.
        permission: row.entry
            ? integrationPermissionSummary(row.entry.permissions).label
            : undefined,
    }))
    const skills = (cfg && Array.isArray(cfg.skills) ? (cfg.skills as unknown[]) : [])
        .map((skill) => describeSkill(skill).name)
        .filter(Boolean)
    const agentsMd =
        cfg && isPlainRecord(cfg.instructions) && typeof cfg.instructions.agents_md === "string"
            ? cfg.instructions.agents_md
            : null
    return {
        workflowId: workflowIdOf(revision) ?? undefined,
        description: typeof revision.description === "string" ? revision.description : undefined,
        model: summary.model ?? undefined,
        provider: summary.provider ?? undefined,
        integrations,
        skills,
        instructions: agentsMd
            ? {fileName: "AGENTS.md", text: agentsMd, wordCount: countWords(agentsMd)}
            : undefined,
    }
}

/** Everything the Subagents picker needs for a batch of workflows, off one cached revision fetch. */
function useWorkflowReferenceCatalog(slugs: string[]): {
    bySlug: Record<string, WorkflowReferenceCatalogEntry | undefined>
    failedSlugs: string[]
    loading: boolean
    retry: () => void
} {
    // Sorted and joined so the same set of slugs, in any order, hits one cached batch.
    const slugsKey = useMemo(() => [...slugs].filter(Boolean).sort().join("\n"), [slugs])
    const res = useAtomValue(referenceTypesQueryAtomFamily(slugsKey))

    const refetch = res.refetch
    return useMemo(() => {
        const data = (res.data ?? {}) as Record<string, ReferenceTypeInfo>
        const bySlug: Record<string, WorkflowReferenceCatalogEntry | undefined> = {}
        const failedSlugs: string[] = []
        for (const [slug, info] of Object.entries(data)) {
            if (info.failed) failedSlugs.push(slug)
            bySlug[slug] = {
                type: info.type,
                workflowId: info.workflowId ?? undefined,
                model: info.model ?? undefined,
                provider: info.provider ?? undefined,
                integrations: info.integrations,
            }
        }
        return {
            bySlug,
            failedSlugs,
            loading: Boolean(res.isLoading),
            retry: () => void refetch(),
        }
    }, [res.data, res.isLoading, refetch])
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

export function useWorkflowReferenceBridge(): WorkflowReferenceBridge {
    const projectId = useAtomValue(projectIdAtom)
    // Lazy: `workflows` stays empty (no apps/evaluators list query) until `activate()` is called
    // — on reference-picker open or when displaying an existing reference (see the consumers).
    const workflows = useAtomValue(workflowReferenceWorkflowsAtom)
    const workflowsLoading = useAtomValue(workflowReferenceLoadingAtom)
    const activate = useSetAtom(activateWorkflowReferenceAtom)
    const store = useStore()

    return useMemo<WorkflowReferenceBridge>(
        () => ({
            enabled: true,
            activate,
            // All project workflows are referenceable (apps + evaluators + …), not just apps. Type
            // (incl. `evaluator`) is resolved per-slug via useWorkflowReferenceCatalog.
            workflows: workflows
                .filter((w) => typeof w.slug === "string")
                .map((w) => ({
                    id: w.id,
                    slug: w.slug as string,
                    name: w.name ?? undefined,
                    description: w.description ?? undefined,
                    // type is resolved asynchronously via useWorkflowReferenceCatalog (needs the revision URI).
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
            useWorkflowReferenceCatalog,
            useSubagentDetail,
        }),
        [activate, workflows, workflowsLoading, projectId, store],
    )
}
