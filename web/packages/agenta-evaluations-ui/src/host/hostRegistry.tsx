/**
 * Eval-view host registry — the component + hook injection seam for the relocated eval
 * view layer (WP-4h, migration plan §12).
 *
 * The eval views (run list, run details) were relocated into `@agenta/evaluations-ui` but
 * legitimately depend on OSS-app-owned React components (entity-reference chips/cells, the
 * annotate drawer, generic drawers, onboarding) and OSS-app hooks (routing, breadcrumbs,
 * project permissions). Those are not eval-specific and must NOT be relocated, so the OSS
 * route shell supplies them through this context. Package views read them by name.
 *
 * Channel summary (see §12.1c):
 *   - state atoms        → `@agenta/evaluations/state` `registerEvalRunInjections` (separate)
 *   - pure utils         → moved to `@agenta/shared` (not seamed)
 *   - components + hooks  → THIS registry
 *
 * `any` is load-bearing here: the host supplies ~40 heterogeneous OSS components and a
 * handful of hooks whose prop/return shapes vary; typing each slot precisely is out of
 * scope for the relocation (see §11.4). The names are the contract.
 *
 * @packageDocumentation
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- heterogeneous host slot shapes; see header. */

import {createContext, useContext, type ComponentType, type ReactNode} from "react"

/** A React hook supplied by the OSS host. Must obey the Rules of Hooks at the call site. */
export type HostHook = (...args: any[]) => any

/** The set of OSS-owned components + hooks the relocated eval views consume by name. */
export interface EvalViewHost {
    /** OSS components rendered as slots (e.g. `ReferenceTag`, `PreviewTestsetCell`). */
    components: Record<string, ComponentType<any>>
    /** OSS hooks invoked by package views (e.g. `useURL`, `useBreadcrumbsEffect`). */
    hooks: Record<string, HostHook>
}

const EvalViewHostContext = createContext<EvalViewHost | null>(null)

/**
 * Supplies the OSS-owned components/hooks to the relocated eval views. Mount once at the
 * eval route shell, wrapping the package view root. The `host` object should be stable
 * (memoize it) so hook references don't change across renders.
 */
export const EvalViewHostProvider = ({
    host,
    children,
}: {
    host: EvalViewHost
    children: ReactNode
}) => <EvalViewHostContext.Provider value={host}>{children}</EvalViewHostContext.Provider>

/** Read the whole host. Throws if no provider is mounted (a wiring bug, not a runtime state). */
export const useEvalViewHost = (): EvalViewHost => {
    const host = useContext(EvalViewHostContext)
    if (!host) {
        throw new Error("useEvalViewHost: no EvalViewHostProvider mounted above this component")
    }
    return host
}

/**
 * Resolve a host-supplied component by name. Throws if the name was never registered —
 * surfacing a wiring gap loudly at mount rather than rendering `undefined`.
 */
export const useHostComponent = <P = any,>(name: string): ComponentType<P> => {
    const {components} = useEvalViewHost()
    const Component = components[name]
    if (!Component) {
        throw new Error(`useHostComponent: host component "${name}" is not registered`)
    }
    return Component as ComponentType<P>
}

/**
 * Resolve a host-supplied hook by name. The returned function MUST be called
 * unconditionally at the top level of the consuming component to satisfy the Rules of
 * Hooks (the host object is stable, so the reference is stable across renders).
 */
export const useHostHook = <T extends HostHook = HostHook>(name: string): T => {
    const {hooks} = useEvalViewHost()
    const hook = hooks[name]
    if (!hook) {
        throw new Error(`useHostHook: host hook "${name}" is not registered`)
    }
    return hook as T
}
