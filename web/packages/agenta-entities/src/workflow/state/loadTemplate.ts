import {projectIdAtom} from "@agenta/shared/state"
import type {AgentaApi} from "@agentaai/api-client"
import {atom} from "jotai"

import {type AgentSetupSelection} from "../agentSetup"
import {
    templateBuilderMessage,
    type AgentStarterTemplate,
    type TemplateConnection,
} from "../agentTemplates"
import {
    loadAgentTemplate,
    type AgentTemplateLoadRequest,
    type AgentTemplateLoadResult,
} from "../api/agentTemplates"

import {buildCreatePayloadFromEphemeral} from "./createPayload"
import {
    consumeWorkflowDraftAtom,
    invalidateWorkflowsListCache,
    workflowBuildKitEnabledAtomFamily,
    workflowBuildKitDisabledOpsAtomFamily,
} from "./store"

export interface LoadAgentTemplateFromEphemeralParams {
    revisionId: string
    template: AgentStarterTemplate
    /** Preserve the host's editable template prompt when it differs from the card default. */
    stagingSessionId?: string
    attachmentIds?: string[]
    initialMessage?: string
    setup?: AgentSetupSelection
}

type ConnectionChoice = NonNullable<AgentTemplateLoadRequest["connection_choices"]>[number]

const selectedConnectionChoice = (
    connection: TemplateConnection,
    connected: Set<string>,
): ConnectionChoice => {
    const integration = [connection.primary.slug, ...(connection.alternatives ?? [])].find((slug) =>
        connected.has(slug),
    )
    if (integration) {
        return {
            connection_key: connection.key,
            kind: "gateway",
            provider: "composio",
            integration,
        }
    }
    return {connection_key: connection.key, kind: "skip"}
}

export const templateConnectionChoices = (
    template: AgentStarterTemplate,
    setup?: AgentSetupSelection,
): ConnectionChoice[] => {
    const connected = new Set(setup?.connectedSlugs ?? [])
    return template.connections.map((connection) => selectedConnectionChoice(connection, connected))
}

type LoadRequest = Omit<AgentTemplateLoadRequest, "project_id">

interface LoadIntent {
    key: string
    request: LoadRequest
}
const intents = new Map<string, LoadIntent>()

const stableJson = (value: unknown): string => {
    if (value === undefined) return "null"
    if (value === null || typeof value !== "object") return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
    const fields = Object.entries(value as Record<string, unknown>)
        .filter(([, field]) => field !== undefined && field !== null)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([name, field]) => `${JSON.stringify(name)}:${stableJson(field)}`)
    return `{${fields.join(",")}}`
}

/**
 * Mirrors `template_request_fingerprint` server-side, field for field and normalization for
 * normalization, so the client reuses a request key exactly when the server would accept the
 * replay and mints a new one whenever the server would answer the changed body with a 409.
 */
const requestFingerprint = (request: LoadRequest): string =>
    stableJson({
        source: request.source,
        base_revision: request.base_revision,
        initial_message: request.initial_message.trim(),
        ui_build_kit_enabled: request.ui_build_kit_enabled,
        ui_disabled_ops: [...new Set(request.ui_disabled_ops ?? [])].sort(),
        connection_choices: [...(request.connection_choices ?? [])].sort((left, right) =>
            `${left.connection_key}:${left.kind}` < `${right.connection_key}:${right.kind}`
                ? -1
                : 1,
        ),
        // The server only fingerprints the staged session once it carries attachments.
        ...(request.attachment_ids?.length
            ? {
                  staging_session_id: request.staging_session_id,
                  attachment_ids: request.attachment_ids,
              }
            : {}),
    })

/**
 * FNV-1a over two seeds. The tag only has to separate two bodies of the same draft, and a
 * collision costs a typed 409 rather than a wrong agent, so it stays plain arithmetic instead
 * of `crypto.subtle`, which is async and missing entirely on the plain-HTTP hosts that many
 * self-hosted installs run on.
 */
const fingerprintTag = (fingerprint: string): string => {
    let low = 0x811c9dc5
    let high = 0x01000193
    for (let index = 0; index < fingerprint.length; index++) {
        const code = fingerprint.charCodeAt(index)
        low = Math.imul(low ^ code, 0x01000193)
        high = Math.imul(high ^ code, 0x85ebca6b)
    }
    return `${(low >>> 0).toString(36)}${(high >>> 0).toString(36)}`
}

/**
 * A stored intent is only ever compared, never trusted. `isLoadIntent` cannot vouch for every
 * optional field (an object where an array belongs makes `requestFingerprint` throw on the
 * spread), and a throw here would wedge the card: the unreadable intent is still in storage, so
 * every retry would re-read it and throw again, with only Cancel as a way out. An intent whose
 * fingerprint will not compute is an intent we cannot match, so it is simply replaced.
 */
const storedFingerprint = (intent: LoadIntent): string | undefined => {
    try {
        return requestFingerprint(intent.request)
    } catch {
        return undefined
    }
}

const isLoadIntent = (value: unknown): value is LoadIntent => {
    const intent = value as LoadIntent | null
    return (
        typeof intent?.key === "string" &&
        typeof intent.request?.initial_message === "string" &&
        typeof intent.request.source?.key === "string"
    )
}

const readIntent = (scope: string): LoadIntent | undefined => {
    if (intents.has(scope)) return intents.get(scope)
    try {
        const stored = globalThis.sessionStorage?.getItem(scope)
        // Anything else under this scope was written by a version that shaped the intent
        // differently; treat it as absent rather than replaying a body we cannot read.
        if (stored) {
            const parsed: unknown = JSON.parse(stored)
            if (isLoadIntent(parsed)) return parsed
        }
    } catch {
        /* Storage may be unavailable. The in-memory intent still survives retries. */
    }
    return undefined
}

const saveIntent = (scope: string, intent: LoadIntent | null) => {
    if (intent) intents.set(scope, intent)
    else intents.delete(scope)
    try {
        if (intent) globalThis.sessionStorage?.setItem(scope, JSON.stringify(intent))
        else globalThis.sessionStorage?.removeItem(scope)
    } catch {
        /* Private browsing may reject storage writes. */
    }
}

export const abandonAgentTemplateLoad = (projectId: string, templateKey: string) => {
    saveIntent(`agent-template-intent:${projectId}:${templateKey}`, null)
}

const inflightLoads = new Map<string, Promise<AgentTemplateLoadResult>>()

export const loadAgentTemplateFromEphemeralAtom = atom(
    null,
    async (
        get,
        set,
        {
            revisionId,
            template,
            initialMessage,
            setup,
            stagingSessionId,
            attachmentIds,
        }: LoadAgentTemplateFromEphemeralParams,
    ): Promise<AgentTemplateLoadResult> => {
        const projectId = get(projectIdAtom)
        if (!projectId) throw new Error("No project ID available")

        const inflightKey = `${projectId}:${revisionId}:${template.source.key}`
        const existing = inflightLoads.get(inflightKey)
        if (existing) return existing

        const pending = (async () => {
            const {data} = buildCreatePayloadFromEphemeral(get, revisionId)
            const seedMessage = initialMessage?.trim() || templateBuilderMessage(template)
            const intentScope = `agent-template-intent:${projectId}:${template.source.key}`
            const request: LoadRequest = {
                source: template.source,
                base_revision: (data ?? {}) as AgentaApi.WorkflowRevisionDataInput,
                initial_message: seedMessage,
                staging_session_id: stagingSessionId,
                attachment_ids: attachmentIds,
                ui_build_kit_enabled: get(workflowBuildKitEnabledAtomFamily(revisionId)),
                ui_disabled_ops: get(workflowBuildKitDisabledOpsAtomFamily(revisionId)),
                connection_choices: templateConnectionChoices(template, setup),
            }
            const fingerprint = requestFingerprint(request)
            const stored = readIntent(intentScope)
            // A stored intent is a retry of THIS request and nothing else. Same body keeps the
            // key, which is what makes the retry idempotent and what carries a creation across a
            // reload. A changed body (an edited prompt, a different base revision) is a new
            // creation and takes a new key: replaying the stored body under the stored key would
            // silently build the agent from the prompt the user just replaced, and it is the one
            // case the server cannot catch, because the body it fingerprints never changed.
            const intent: LoadIntent =
                stored && storedFingerprint(stored) === fingerprint
                    ? stored
                    : {
                          key: `agent-template:${revisionId}:${template.source.key}:${fingerprintTag(fingerprint)}`,
                          request,
                      }
            // One intent per project and template, overwritten in place, so a superseded one is
            // replaced rather than left behind under a key nothing reads again.
            saveIntent(intentScope, intent)
            const result = await loadAgentTemplate(intent.request, intent.key, projectId)

            set(
                workflowBuildKitEnabledAtomFamily(result.revision_id),
                intent.request.ui_build_kit_enabled ?? false,
            )
            set(
                workflowBuildKitDisabledOpsAtomFamily(result.revision_id),
                intent.request.ui_disabled_ops ?? [],
            )
            set(consumeWorkflowDraftAtom, revisionId)
            invalidateWorkflowsListCache()
            saveIntent(intentScope, null)
            return result
        })()

        inflightLoads.set(inflightKey, pending)
        try {
            return await pending
        } finally {
            if (inflightLoads.get(inflightKey) === pending) inflightLoads.delete(inflightKey)
        }
    },
)
