/**
 * Host seams.
 *
 * The observability state layer is scoped by an app and a workflow context that
 * only the desktop app has. Rather than reach into an OSS store, the package
 * declares the shape it needs and each host binds an atom to read it from.
 *
 * Binding an *atom* (not a value) matters: the query atoms read the scope
 * synchronously during evaluation, so a host that pushed values from an effect
 * would fire one disabled query per mount before the real scope arrived.
 */
import type {WorkflowKindForTraceDefault} from "@agenta/entities/workflow"
import {atom, type Atom} from "jotai"

export interface ObservabilityScope {
    /** App the trace query pins to — the route app, falling back to the last-used one. */
    appId: string | null
    /**
     * App id from the route only. Scopes persisted filters and builds the
     * `references.application.id` filter row; deliberately does NOT fall back to
     * a remembered app, or filters would leak between apps.
     */
    routeAppId: string | null
}

export interface ObservabilityWorkflowContext {
    workflowId: string | null
    workflowKind: WorkflowKindForTraceDefault | null
    /** True while the host is still resolving the route id into a workflow. */
    isResolving: boolean
}

const fallbackScopeAtom = atom<ObservabilityScope>({appId: null, routeAppId: null})
const fallbackWorkflowContextAtom = atom<ObservabilityWorkflowContext>({
    workflowId: null,
    workflowKind: null,
    isResolving: false,
})

const scopeSourceAtom = atom<Atom<ObservabilityScope>>(fallbackScopeAtom)
const workflowContextSourceAtom = atom<Atom<ObservabilityWorkflowContext>>(
    fallbackWorkflowContextAtom,
)

/** Current observability scope. Defaults to project-wide until a host binds one. */
export const observabilityScopeAtom = atom((get) => get(get(scopeSourceAtom)))

/** Current workflow context. Defaults to "no workflow" until a host binds one. */
export const observabilityWorkflowContextAtom = atom((get) => get(get(workflowContextSourceAtom)))

/** Host seam: point the scope at one of the host's own atoms. */
export const bindObservabilityScopeAtom = atom(
    null,
    (_get, set, source: Atom<ObservabilityScope>) => set(scopeSourceAtom, source),
)

/** Host seam: point the workflow context at one of the host's own atoms. */
export const bindObservabilityWorkflowContextAtom = atom(
    null,
    (_get, set, source: Atom<ObservabilityWorkflowContext>) =>
        set(workflowContextSourceAtom, source),
)
