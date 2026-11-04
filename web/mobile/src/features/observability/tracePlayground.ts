import {extractAgData, extractInputs, type TraceSpanNode} from "@agenta/entities/trace"
import {closeTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {extractReferences, looksLikePromptConfig, resolveTraceRefs} from "@agenta/playground"
import {encodeSnapshot, SNAPSHOT_VERSION} from "@agenta/playground/snapshot"
import {message} from "@agenta/ui/app-message"
import {getDefaultStore} from "jotai"
import type {NextRouter} from "next/router"

import {agentEntryHref} from "../agents/agentEntry"
import {evaluatorPlaygroundHref, playgroundHref, withSnapshot} from "../playground/playgroundUrl"

/**
 * The trace drawer's "Playground" action. Loaded on the first click, so the drawer, which every
 * page carries, holds none of this code.
 *
 * /w seeds the playground store from the span and then navigates. /m does not touch the store:
 * the agent session screen shares it. The span's inputs travel in the address instead, as one
 * local test case in the `#pgSnapshot` hash, so the link is also one a reload or a colleague
 * opens the same way.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const hasAgentSpan = (span: TraceSpanNode): boolean =>
    span.span_type === "agent" || (span.children ?? []).some(hasAgentSpan)

/**
 * The span's inputs as a test case: the template inputs, with the chat messages beside them
 * when the span nests them (`{inputs, messages, parameters}`), and without a prompt template
 * captured as an argument. Same rule as the package's `openFromTrace` for a revision.
 */
const testcaseInputs = (span: TraceSpanNode): Record<string, unknown> => {
    let raw = extractInputs(span)
    const agInputs = extractAgData(span).inputs
    if (Object.keys(raw).length === 0 && typeof agInputs === "string") {
        try {
            const parsed: unknown = JSON.parse(agInputs)
            if (isRecord(parsed)) raw = parsed
        } catch {
            // Not JSON: the span has no inputs to replay.
        }
    }
    const inputs = !isRecord(raw.inputs)
        ? raw
        : Array.isArray(raw.messages)
          ? {...raw.inputs, messages: raw.messages}
          : raw.inputs
    return Object.fromEntries(
        Object.entries(inputs).filter(([, value]) => !looksLikePromptConfig(value)),
    )
}

export type TracePlaygroundTarget =
    | {kind: "link"; href: string}
    | {kind: "no-app"}
    | {kind: "span-type"; spanType: string}

/** Where a span opens, from its resolved app and revision. */
export const tracePlaygroundTarget = ({
    base,
    span,
    refs,
}: {
    base: string
    span: TraceSpanNode
    refs: {appId: string | null; revisionId: string | null}
}): TracePlaygroundTarget => {
    const {appId, revisionId} = refs
    // The drawer's button allows a chat span, which /w replays as a copy in its revision drawer.
    // /m has no such drawer, and the span's prompt inputs do not fit the app's inputs.
    if (span.span_type === "chat") return {kind: "span-type", spanType: span.span_type}
    if (!appId) return {kind: "no-app"}
    // An agent run replays in the agent chat (decision F-D4).
    if (hasAgentSpan(span)) return {kind: "link", href: agentEntryHref(base, appId)}
    if (!revisionId) return {kind: "no-app"}

    const href = playgroundHref(base, appId, [revisionId])
    const inputs = testcaseInputs(span)
    if (Object.keys(inputs).length === 0) return {kind: "link", href}
    const encoded = encodeSnapshot({
        v: SNAPSHOT_VERSION,
        selection: [{kind: "commit", id: revisionId, runnableType: "workflow"}],
        drafts: [],
        localTestset: {rows: [{data: inputs}], name: null},
    })
    // Inputs too large for an address: the revision still opens, with an empty test case.
    return {
        kind: "link",
        href: encoded.ok && encoded.encoded ? withSnapshot(href, encoded.encoded) : href,
    }
}

/**
 * Resolves the span's app and revision (a span can name them by slug: one request) and returns
 * where it opens.
 */
export const resolveTracePlaygroundTarget = async ({
    base,
    projectId,
    span,
}: {
    base: string
    projectId: string
    span: TraceSpanNode
}): Promise<TracePlaygroundTarget> => {
    const refs = extractReferences(span)
    // An evaluator span replays the evaluator: its revision opens in the evaluator playground.
    if (refs.evaluator || refs.evaluator_revision) {
        const evaluatorRevisionId = refs.evaluator_revision?.id
        return evaluatorRevisionId
            ? {kind: "link", href: evaluatorPlaygroundHref(base, evaluatorRevisionId)}
            : {kind: "no-app"}
    }
    const appId = refs.application?.id ?? null
    const revisionId = refs.application_revision?.id ?? null
    const resolved =
        appId && revisionId ? {appId, revisionId} : await resolveTraceRefs(refs, projectId)
    return tracePlaygroundTarget({
        base,
        span,
        refs: {appId: appId ?? resolved.appId, revisionId: revisionId ?? resolved.revisionId},
    })
}

/**
 * Opens the span: the drawer closes and the page moves to the playground or the agent chat. A
 * span with no app says so. Returns null, so the drawer does no navigation of its own.
 */
export const openTraceInPlayground = async (router: NextRouter, span: TraceSpanNode) => {
    const {workspace_id: workspaceId, project_id: projectId} = router.query
    if (typeof workspaceId !== "string" || typeof projectId !== "string") return null
    const target = await resolveTracePlaygroundTarget({
        base: `/w/${workspaceId}/p/${projectId}`,
        projectId,
        span,
    })
    if (target.kind === "no-app") {
        message.info("This trace has no app, so it cannot open in the playground.")
        return null
    }
    if (target.kind === "span-type") {
        message.info(
            `"${target.spanType}" spans can't be replayed in the playground. Open the parent workflow, task, agent, or chain span instead.`,
        )
        return null
    }
    // Close the drawer once the new page shows. A closed drawer clears `?trace` from the address,
    // and that push cancels the playground navigation while its page still loads.
    void router
        .push(target.href)
        .then(() => getDefaultStore().set(closeTraceDrawerAtom))
        .catch(() => undefined)
    return null
}
