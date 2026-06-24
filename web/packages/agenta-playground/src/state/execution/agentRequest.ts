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
 * Envelope (agreed with backend 2026-06-19):
 *   { session_id, references, data: { messages, parameters } }
 *  - `parameters` is the DRAFT-AWARE config (`workflowMolecule.selectors.configuration`,
 *    merged draft + server) so unsaved left-panel edits apply to the agent run.
 *  - `harness` lives on the agent config (`parameters.agent`), defaulted but never
 *    overriding a value the resolved config already carries.
 *  - `project_id` / `application_id` ride the URL QUERY (never the body), and
 *    `project_id` only travels alongside auth — mirroring `executionItems.ts`.
 */
import {workflowMolecule} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"

import {executionHeadersAtom} from "./webWorkerIntegration"

export interface AgentRequest {
    invocationUrl: string
    requestBody: Record<string, unknown>
    headers: Record<string, string>
}

/** Minimal store surface — the default Jotai store, or a test store. */
type StoreLike = Pick<ReturnType<typeof getDefaultStore>, "get">

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
 * generically so it works wherever `mcp_servers` / `skills` are nested.
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

const pruneBlankEntries = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(pruneBlankEntries)
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {}
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            if (key === "mcp_servers" && Array.isArray(val)) {
                out[key] = val.filter(hasUsableName).map(pruneBlankEntries)
            } else if (key === "skills" && Array.isArray(val)) {
                out[key] = val.filter(isUsableSkill).map(pruneBlankEntries)
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
 * Default the agent run-selection field `harness` onto the AGENT CONFIG (`parameters.agent`),
 * not as a top-level params sibling. It is part of one `AgentConfig` now, so it belongs inside
 * the `agent` block. A value the resolved config already carries always wins; the schema nests
 * the config under `agent`, but a flat config (no `agent` key) is still defaulted at the top
 * level so a non-schema config keeps working. The sidecar `uri` is left unset (the server's
 * env-var routing fallback); it is an operator override, not a per-run default.
 */
// Legacy pre-migration run-selection keys that now live inside `agent`. Stripped from the
// top level when `agent` is present so we never emit both wire shapes for one config.
const LEGACY_RUN_SELECTION_KEYS = ["harness", "sandbox", "permission_policy"] as const

const withAgentRunDefaults = (config: Record<string, unknown>): Record<string, unknown> => {
    const agent = config.agent
    if (agent && typeof agent === "object") {
        const rest = {...config}
        for (const key of LEGACY_RUN_SELECTION_KEYS) delete rest[key]
        return {
            ...rest,
            agent: {harness: "pi_core", ...(agent as Record<string, unknown>)},
        }
    }
    return {harness: "pi_core", ...config}
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
 * @param messages  `useChat`'s `UIMessage[]` (sent verbatim under `data.messages`)
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

    // The agent lane talks to the v6 UI Message Stream endpoint (`/messages`), NOT
    // the batch `/invoke`. `/messages` ingests AI-SDK UIMessages (parts-aware, via
    // the SDK's vercel adapter) and streams the v6 response `useChat` consumes;
    // `/invoke` is content-based and one-shot, so it drops the UIMessage `parts`
    // (every turn arrives empty → "No user message to send"). Same query/auth.
    const messagesUrl = invocationUrl.replace(/\/invoke(?=$|\?)/, "/messages")

    // Draft-aware config — unsaved left-panel prompt edits apply to the run.
    const config = store.get(workflowMolecule.selectors.configuration(entityId)) as
        | Record<string, unknown>
        | null
        | undefined
    // `harness` is a run-selection field on the AGENT CONFIG (`parameters.agent`), not a
    // top-level params sibling. Default it inside the `agent` block, never overriding a value
    // the resolved config already carries.
    const parameters = pruneBlankEntries(withAgentRunDefaults(config ?? {})) as Record<
        string,
        unknown
    >

    const entity = store.get(workflowMolecule.selectors.data(entityId)) as
        | RevisionLike
        | null
        | undefined
    const references = buildAgentReferences(entity)

    const headersFactory = store.get(executionHeadersAtom)
    // `Accept: text/event-stream` makes the agent `/messages` endpoint serve the v6
    // SSE stream `useChat` consumes. Without it the endpoint negotiates down to a
    // batch JSON response (Accept defaults to `*/*`; the AI-SDK transport sets no
    // Accept), which `useChat` can't render — the run succeeds but nothing appears.
    const headers: Record<string, string> = {
        Accept: "text/event-stream",
        ...(headersFactory ? await headersFactory() : {}),
    }

    const projectId = store.get(projectIdAtom) || undefined
    const appId = references?.application?.id
    const url = withQuery(messagesUrl, {
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
            data: {messages: history, parameters},
        },
    }
}
