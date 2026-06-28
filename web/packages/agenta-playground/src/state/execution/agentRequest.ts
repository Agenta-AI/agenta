/**
 * Agent-lane request builder.
 *
 * The agent generation lane reuses the playground's request-building knowledge
 * but BYPASSES buffered-fetch execution and the flat message store — `useChat`
 * owns the streamed v6 conversation. `buildAgentRequest` composes the molecule
 * selectors the standard builder reads (`invocationUrl`, `configuration`, the
 * entity identity for `references`) WITHOUT going through `createExecutionItemHandle`,
 * which carries execution side-effects (advances `runId`/`attemptCount`, coerces
 * mode, is built to dispatch). Keeping this in the package — not OSS — means the
 * "do not hand-roll the request" rule is enforced by the boundary, and the agent
 * panel can't accidentally drop `references`, mis-place `project_id`, or leak a
 * local-draft id (the three surprises the design doc warns about).
 *
 * Returned shape feeds `useChat`'s `prepareSendMessagesRequest`:
 *   { invocationUrl, requestBody, headers } | null   (null → not runnable)
 *
 * Envelope (canonical `/invoke`):
 *   { session_id, references, data: { inputs: { messages }, parameters } }
 *  - `parameters` is the DRAFT-AWARE config (`workflowMolecule.selectors.configuration`,
 *    merged draft + server) so unsaved left-panel edits apply to the agent run.
 *  - the execution sections (`harness`/`runner`/`sandbox`) are nested in the agent template at
 *    `parameters.agent`, defaulted but never overriding a value the resolved config carries.
 *  - `project_id` / `application_id` ride the URL QUERY (never the body), and
 *    `project_id` only travels alongside auth — mirroring `executionItems.ts`.
 */
import {
    workflowAgentTemplateOverlayAtomFamily,
    workflowBuildKitEnabledAtomFamily,
    workflowMolecule,
    type AgentTemplate,
} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"

import {agentChannelModeAtom} from "./channelMode"
import {executionHeadersAtom} from "./webWorkerIntegration"

export interface AgentRequest {
    invocationUrl: string
    requestBody: Record<string, unknown>
    headers: Record<string, string>
}

/** Minimal store surface — the default Jotai store, or a test store. */
type StoreLike = Pick<ReturnType<typeof getDefaultStore>, "get">

type AgentTemplateListKey = "tools" | "skills" | "mcps"
type AgentTemplateObjectKey = "sandbox" | "runner" | "harness" | "llm" | "instructions"

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

const embedWorkflowSlug = (entry: unknown): string | undefined => {
    if (!isRecord(entry)) return undefined
    const embed = entry["@ag.embed"]
    if (!isRecord(embed)) return undefined
    const refs = embed["@ag.references"]
    if (!isRecord(refs)) return undefined
    const workflow = refs.workflow
    if (isRecord(workflow) && typeof workflow.slug === "string") return workflow.slug
    const revision = refs.workflow_revision
    if (isRecord(revision) && typeof revision.slug === "string") return revision.slug
    return undefined
}

const deepMerge = (
    base: Record<string, unknown>,
    overlay: Record<string, unknown>,
): Record<string, unknown> => {
    const result: Record<string, unknown> = {...base}
    for (const [key, value] of Object.entries(overlay)) {
        const existing = result[key]
        result[key] = isRecord(existing) && isRecord(value) ? deepMerge(existing, value) : value
    }
    return result
}

const getToolIdentity = (entry: unknown): string | undefined => {
    if (!isRecord(entry)) return undefined
    if (entry.type === "platform" && typeof entry.op === "string") return `platform:${entry.op}`
    const slug = embedWorkflowSlug(entry)
    if (slug) return `workflow:${slug}`
    return typeof entry.name === "string" ? `name:${entry.name}` : undefined
}

const getSkillIdentity = (entry: unknown): string | undefined => {
    const slug = embedWorkflowSlug(entry)
    return slug ? `workflow:${slug}` : undefined
}

const getMcpIdentity = (entry: unknown): string | undefined => {
    if (!isRecord(entry)) return undefined
    return typeof entry.name === "string" ? entry.name : undefined
}

const identityMerge = (
    base: unknown[],
    overlay: unknown[],
    getIdentity: (entry: unknown) => string | undefined,
): unknown[] => {
    const result = [...base]
    const indexByIdentity = new Map<string, number>()
    result.forEach((entry, index) => {
        const identity = getIdentity(entry)
        if (identity) indexByIdentity.set(identity, index)
    })
    overlay.forEach((entry) => {
        const identity = getIdentity(entry)
        const index = identity ? indexByIdentity.get(identity) : undefined
        if (index !== undefined) {
            result[index] = entry
            return
        }
        if (identity) indexByIdentity.set(identity, result.length)
        result.push(entry)
    })
    return result
}

export function applyBuildKitOverlay(
    base: AgentTemplate,
    overlay: Partial<AgentTemplate>,
): AgentTemplate {
    const result: AgentTemplate = {...base}

    for (const key of [
        "sandbox",
        "runner",
        "harness",
        "llm",
        "instructions",
    ] as const satisfies readonly AgentTemplateObjectKey[]) {
        const overlayValue = overlay[key]
        if (overlayValue !== undefined) {
            result[key] = deepMerge(
                isRecord(base[key]) ? (base[key] as Record<string, unknown>) : {},
                isRecord(overlayValue) ? overlayValue : {},
            )
        }
    }

    const listMergers: Record<AgentTemplateListKey, (entry: unknown) => string | undefined> = {
        tools: getToolIdentity,
        skills: getSkillIdentity,
        mcps: getMcpIdentity,
    }

    for (const key of Object.keys(listMergers) as AgentTemplateListKey[]) {
        const overlayValue = overlay[key]
        if (Array.isArray(overlayValue)) {
            result[key] = identityMerge(
                Array.isArray(base[key]) ? (base[key] as unknown[]) : [],
                overlayValue,
                listMergers[key],
            )
        }
    }

    return result
}

const withBuildKitOverlay = (
    parameters: Record<string, unknown>,
    overlay: AgentTemplate | null,
    enabled: boolean,
): Record<string, unknown> => {
    if (!enabled || !overlay || !isRecord(parameters.agent)) return parameters
    return {
        ...parameters,
        agent: applyBuildKitOverlay(parameters.agent as AgentTemplate, overlay),
    }
}

// Backend rejects local-draft ids; only forward real UUIDs in `references`.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const realId = (value: unknown): string | undefined => {
    const s = typeof value === "string" ? value : undefined
    return s && UUID_RE.test(s) ? s : undefined
}
const str = (value: unknown): string | undefined =>
    typeof value === "string" && value ? value : undefined

interface RevisionLike {
    id?: string
    slug?: string
    version?: number | string | null
    workflow_id?: string
    workflow_slug?: string
    workflow_variant_id?: string
    workflow_variant_slug?: string
    artifact_id?: string
    artifact_slug?: string
    variant_id?: string
    variant_slug?: string
}

interface AgentReferences {
    application?: Record<string, string>
    application_variant?: Record<string, string>
    application_revision?: Record<string, string>
}

/**
 * Build the `references` block from the entity's identity, dropping any
 * local-draft (non-UUID) ids so the backend doesn't 422.
 */
export function buildAgentReferences(rev: RevisionLike | null | undefined): AgentReferences | null {
    if (!rev) return null
    const refs: AgentReferences = {}

    const appId = realId(rev.workflow_id) ?? realId(rev.artifact_id)
    const appSlug = str(rev.workflow_slug) ?? str(rev.artifact_slug)
    if (appId || appSlug) {
        refs.application = {...(appId ? {id: appId} : {}), ...(appSlug ? {slug: appSlug} : {})}
    }

    const variantId = realId(rev.workflow_variant_id) ?? realId(rev.variant_id)
    const variantSlug = str(rev.workflow_variant_slug) ?? str(rev.variant_slug)
    if (variantId || variantSlug) {
        refs.application_variant = {
            ...(variantId ? {id: variantId} : {}),
            ...(variantSlug ? {slug: variantSlug} : {}),
        }
    }

    const revId = realId(rev.id)
    const revSlug = str(rev.slug)
    const revVersion = typeof rev.version === "number" ? String(rev.version) : str(rev.version)
    if (revId || revSlug || revVersion) {
        refs.application_revision = {
            ...(revId ? {id: revId} : {}),
            ...(revSlug ? {slug: revSlug} : {}),
            ...(revVersion ? {version: revVersion} : {}),
        }
    }

    return Object.keys(refs).length > 0 ? refs : null
}

/**
 * Drop half-filled MCP server / skill entries anywhere in the config before sending.
 *
 * The backend validates an MCP server `name` (and a skill's `name`/`description`/`body`)
 * as min-length 1, so a blank entry — e.g. an "Add MCP server" or "Add skill" block the
 * user hasn't filled in yet — 500s the whole run ("… too short"). Walks the parameters
 * generically so it works wherever `mcps` / `skills` are nested (under `agent`).
 */
const hasUsableName = (entry: unknown): boolean => {
    const name = (entry as {name?: unknown} | null)?.name
    return typeof name === "string" && name.trim().length > 0
}

/**
 * A skill entry is keepable when it is an `@ag.embed` reference (the backend inlines it,
 * it carries no inline fields to validate) OR a non-blank inline package. A freshly added
 * skill (blank name/description/body) is dropped so it can't 500 the run.
 */
const isUsableSkill = (entry: unknown): boolean => {
    if (entry && typeof entry === "object" && "@ag.embed" in (entry as Record<string, unknown>)) {
        return true
    }
    const skill = entry as {name?: unknown; description?: unknown; body?: unknown} | null
    const filled = (v: unknown) => typeof v === "string" && v.trim().length > 0
    return filled(skill?.name) && filled(skill?.description) && filled(skill?.body)
}

/**
 * Whether a function-tool name is a gateway slug (`tools.provider.integration.action.connection`,
 * `__` or `.` separated). Mirrors the backend's `_parse_gateway_slug` so we leave gateway tools in
 * the OpenAI `function` shape the backend already coerces, and only rewrite genuine custom tools.
 */
const isGatewaySlug = (name: unknown): boolean => {
    if (typeof name !== "string") return false
    const parts = name.replace(/__/g, ".").split(".")
    return parts.length === 5 && parts[0] === "tools"
}

/**
 * Normalize a custom in-line function tool to the agent contract's typed `client` config.
 *
 * The shared tool form (also used by the prompt playground) stores tools in the OpenAI shape
 * `{type: "function", function: {name, description, parameters}}`. The agent backend's
 * `coerce_tool_config` only accepts typed configs (`builtin`/`gateway`/`code`/`client`), so a
 * custom function tool 500s the run ("Unsupported tool configuration shape"). A schema-only
 * function tool IS a client tool (the model emits the call, the app executes it), so emit the
 * `ClientToolConfig` shape: `{type: "client", name, description, input_schema, permission}`.
 *
 * Left untouched: already-typed tools (a `type` other than `function`), and gateway-slug function
 * tools (the backend coerces those from `function.name` directly).
 */
const normalizeAgentToolShape = (tool: unknown): unknown => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return tool
    const t = tool as Record<string, unknown>
    if (t.type !== "function") return tool
    const fn =
        t.function && typeof t.function === "object"
            ? (t.function as Record<string, unknown>)
            : null
    if (!fn || typeof fn.name !== "string") return tool
    if (isGatewaySlug(fn.name)) return tool

    const client: Record<string, unknown> = {type: "client", name: fn.name}
    if (typeof fn.description === "string" && fn.description) client.description = fn.description
    client.input_schema =
        fn.parameters && typeof fn.parameters === "object"
            ? fn.parameters
            : {type: "object", properties: {}}
    if (t.permission !== undefined) client.permission = t.permission
    if (t.needs_approval !== undefined) client.needs_approval = t.needs_approval
    return client
}

const pruneBlankEntries = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(pruneBlankEntries)
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {}
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            if (key === "mcps" && Array.isArray(val)) {
                out[key] = val.filter(hasUsableName).map(pruneBlankEntries)
            } else if (key === "skills" && Array.isArray(val)) {
                out[key] = val.filter(isUsableSkill).map(pruneBlankEntries)
            } else if (key === "tools" && Array.isArray(val)) {
                // Rewrite custom function tools to the typed `client` shape the agent backend
                // accepts; gateway/typed tools pass through unchanged.
                out[key] = val.map((tool) => pruneBlankEntries(normalizeAgentToolShape(tool)))
            } else {
                out[key] = pruneBlankEntries(val)
            }
        }
        return out
    }
    return value
}

/**
 * Drop answer-less assistant turns from the history before sending. `useChat` keeps every
 * turn it created — including ones where the model ended without an answer (no text/tool/file,
 * maybe only a thought). Replaying those empty assistant messages back to the model poisons
 * the prompt: the provider sees blank assistant turns and tends to keep producing blank ones,
 * so one answer-less turn cascades into every later turn failing. We still SHOW them in the UI
 * (the "no response" note); we just don't feed them back. User turns are always kept.
 */
const isAnswerPart = (p: unknown): boolean => {
    const type = (p as {type?: unknown})?.type
    if (typeof type !== "string") return false
    if (type === "text") {
        const text = (p as {text?: unknown}).text
        return typeof text === "string" && text.trim().length > 0
    }
    return type.startsWith("tool-") || type === "dynamic-tool" || type === "file"
}

const hasAnswer = (message: unknown): boolean => {
    const msg = message as {role?: unknown; parts?: unknown}
    if (msg?.role !== "assistant") return true
    return Array.isArray(msg.parts) && msg.parts.some(isAnswerPart)
}

/**
 * Default the execution sections onto the agent template before sending.
 *
 * `config` is the full `parameters`; the template lives at `parameters.agent` (the definition flat
 * plus nested `harness` / `runner` / `sandbox` sections). The execution sections are defaulted
 * (harness `pi_core`, runner `sidecar` answering headless interactions `auto`, sandbox `local`) so a
 * config that omits them still runs; a value the resolved config carries always wins (spread last).
 * The definition fields are passed through untouched.
 */
const withSection = (
    section: unknown,
    defaults: Record<string, unknown>,
): Record<string, unknown> => ({
    ...defaults,
    ...(section && typeof section === "object" && !Array.isArray(section)
        ? (section as Record<string, unknown>)
        : {}),
})

const withTemplateDefaults = (template: Record<string, unknown>): Record<string, unknown> => ({
    ...template,
    harness: withSection(template.harness, {kind: "pi_core"}),
    runner: withSection(template.runner, {
        kind: "sidecar",
        interactions: {headless: "auto"},
    }),
    sandbox: withSection(template.sandbox, {kind: "local"}),
})

const withAgentRunDefaults = (config: Record<string, unknown>): Record<string, unknown> => {
    const template = config.agent
    if (template && typeof template === "object" && !Array.isArray(template)) {
        return {...config, agent: withTemplateDefaults(template as Record<string, unknown>)}
    }
    // No `agent` wrapper (a bare template) — default its sections directly.
    return withTemplateDefaults(config)
}

const withQuery = (url: string, params: Record<string, string | undefined>): string => {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
        if (value) qs.set(key, value)
    }
    const suffix = qs.toString()
    return suffix ? `${url}${url.includes("?") ? "&" : "?"}${suffix}` : url
}

/**
 * Compose the agent invocation request for `entityId` with the current `messages`.
 * Returns `null` when the entity has no invocation URL (not runnable).
 *
 * @param entityId  revision id of the agent workflow
 * @param messages  `useChat`'s `UIMessage[]` (sent under `data.inputs.messages`)
 * @param opts.sessionId  the conversation's session id (envelope `session_id`)
 * @param opts.store      optional store override (tests inject a seeded store)
 */
export async function buildAgentRequest(
    entityId: string,
    messages: unknown[],
    opts: {sessionId: string; store?: StoreLike},
): Promise<AgentRequest | null> {
    const store = opts.store ?? getDefaultStore()

    const invocationUrl = store.get(workflowMolecule.selectors.invocationUrl(entityId)) as
        | string
        | null
        | undefined
    if (!invocationUrl) return null

    // The agent lane talks to `/invoke` with `x-ag-messages-format: vercel`: the SDK
    // ingests AI-SDK UIMessages (parts-aware, via the vercel adapter) and projects the
    // v6 UI Message Stream `useChat` consumes. `Accept: text/event-stream` selects the
    // stream; the vercel format header selects the UI-message projection over plain SSE.

    // Draft-aware config — unsaved left-panel prompt edits apply to the run.
    const config = store.get(workflowMolecule.selectors.configuration(entityId)) as
        | Record<string, unknown>
        | null
        | undefined
    // The execution sections (`harness`/`runner`/`sandbox`) are nested in the template at
    // `parameters.agent`. Default them, never overriding values the resolved config carries.
    const buildKitEnabled = store.get(workflowBuildKitEnabledAtomFamily(entityId)) as boolean
    const agentTemplateOverlay = store.get(
        workflowAgentTemplateOverlayAtomFamily(entityId),
    ) as AgentTemplate | null
    const parameters = pruneBlankEntries(
        withBuildKitOverlay(
            withAgentRunDefaults(config ?? {}) as Record<string, unknown>,
            agentTemplateOverlay,
            buildKitEnabled,
        ),
    ) as Record<string, unknown>

    const entity = store.get(workflowMolecule.selectors.data(entityId)) as
        | RevisionLike
        | null
        | undefined

    // Whether the run may CLAIM its committed identity. The service derives draft-ness purely
    // from a resolved committed-revision reference — `services/oss/src/agent/tracing.py`
    // `_run_context_workflow`: `is_draft = revision is None` — and a self-targeting "update myself"
    // tool binds the revision/variant that reference resolves to. So the run may forward the
    // reference family ONLY when it is actually running that committed revision unchanged:
    //  - dirty (unsaved left-panel edits): the run is an inline-config draft; forwarding the
    //    revision would wrongly mark it non-draft and bind a tool to a revision whose config
    //    differs from what's running. The resolver also re-resolves a bare variant ref to its
    //    latest revision, so the variant must be dropped too — send no references at all.
    //  - uncommitted local draft (no real revision UUID): same inline-config-draft case.
    // This matches the service's documented contract: "a playground run of an unsaved inline
    // config carries no revision reference, so is_draft is True". App scoping rides the
    // `application_id` URL query (derived below), so a draft run stays associated with its app.
    const fullReferences = buildAgentReferences(entity)
    const isDirty = store.get(workflowMolecule.selectors.isDirty(entityId)) as boolean
    const isCommittedRevisionRun =
        !isDirty && typeof fullReferences?.application_revision?.id === "string"
    const references = isCommittedRevisionRun ? fullReferences : null

    const headersFactory = store.get(executionHeadersAtom)
    // Negotiation 1 (transport): the Accept header picks the response channel `/invoke`
    // content-negotiates, driven by the playground's channel toggle:
    //  - `text/event-stream` → the v6 SSE stream `useChat` renders token-by-token (default).
    //  - `application/json` → a single `WorkflowBatchResponse`; `AgentChatTransport` replays it
    //    as a one-shot UIMessage stream so the reply lands in one frame.
    // (A bare `*/*` negotiates down to batch JSON plain `useChat` can't render, so always
    // send an explicit Accept.)
    // Negotiation 2 (format): `x-ag-messages-format: vercel` selects the vercel adapter for
    // the UIMessage request body (`data.inputs.messages`) and the response projection.
    const channelMode = store.get(agentChannelModeAtom)
    const headers: Record<string, string> = {
        Accept: channelMode === "batch" ? "application/json" : "text/event-stream",
        "x-ag-messages-format": "vercel",
        ...(headersFactory ? await headersFactory() : {}),
    }

    const projectId = store.get(projectIdAtom) || undefined
    // App scoping rides the URL even for a draft run (where `references` is null), so the run
    // stays associated with its app — read it from the full identity, not the gated `references`.
    const appId = fullReferences?.application?.id
    const url = withQuery(invocationUrl, {
        application_id: appId,
        // Mirror executionItems.ts: project_id only travels alongside auth.
        project_id: headers.Authorization ? projectId : undefined,
    })

    // Strip answer-less assistant turns so a "no response" turn can't poison the next request.
    const history = messages.filter(hasAnswer)

    return {
        invocationUrl: url,
        headers,
        requestBody: {
            session_id: opts.sessionId,
            references,
            data: {inputs: {messages: history}, parameters},
        },
    }
}
