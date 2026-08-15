/**
 * Binds the OSS atoms that `@agenta/observability` reads through its host seams.
 *
 * Sources, not snapshots — the package reads these synchronously while its query
 * atoms evaluate, so pushing values from an effect would fire a disabled query
 * on every mount first.
 */
import {bindWorkspaceMembersAtom} from "@agenta/entities/organization"
import type {WorkspaceMember} from "@agenta/entities/organization"
import {
    bindObservabilityScopeAtom,
    bindObservabilityWorkflowContextAtom,
    type ObservabilityScope,
    type ObservabilityWorkflowContext,
} from "@agenta/observability"
import {
    bindTraceDrawerBaseAppURLAtom,
    bindTraceDrawerProjectURLAtom,
} from "@agenta/observability/traceDrawer"
import {atom} from "jotai"

import {routerAppIdAtom} from "@/oss/state/app"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {selectedOrgAtom} from "@/oss/state/org"
import {urlAtom} from "@/oss/state/url"
import {currentWorkflowContextAtom} from "@/oss/state/workflow"

const ossObservabilityScopeAtom = atom<ObservabilityScope>((get) => ({
    appId: get(selectedAppIdAtom),
    routeAppId: get(routerAppIdAtom),
}))

const ossObservabilityWorkflowContextAtom = atom<ObservabilityWorkflowContext>((get) => {
    const ctx = get(currentWorkflowContextAtom)
    return {
        workflowId: ctx.workflowId ?? null,
        workflowKind: ctx.workflowKind ?? null,
        isResolving: ctx.isResolving,
    }
})

const ossWorkspaceMembersAtom = atom<WorkspaceMember[]>(
    (get) => get(selectedOrgAtom)?.default_workspace?.members ?? [],
)

// The trace drawer links out to evaluators/apps; it needs this app's project URL.
const ossProjectURLAtom = atom<string>((get) => get(urlAtom).projectURL ?? "")
const ossBaseAppURLAtom = atom<string>((get) => get(urlAtom).baseAppURL ?? "")

/** Written once, at provider mount. */
export const bindObservabilityHostAtoms = atom(null, (_get, set) => {
    set(bindTraceDrawerProjectURLAtom, ossProjectURLAtom)
    set(bindTraceDrawerBaseAppURLAtom, ossBaseAppURLAtom)
    set(bindObservabilityScopeAtom, ossObservabilityScopeAtom)
    set(bindObservabilityWorkflowContextAtom, ossObservabilityWorkflowContextAtom)
    set(bindWorkspaceMembersAtom, ossWorkspaceMembersAtom)
})
