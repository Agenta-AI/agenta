/**
 * Host seam for trace-drawer navigation.
 *
 * The drawer links out to evaluators, apps and testsets, which needs the host's project URL and
 * its router. Both live in the app's routing layer (`useURL`, `next/router`), so the package
 * declares the shape it needs and each host binds it — the same contract as the scope seam next
 * door, for the same reason: the URL is read while atoms evaluate, not pushed from an effect.
 */
import {atom, type Atom} from "jotai"

/** Navigates the host to an in-app href. */
export type TraceDrawerNavigate = (href: string) => void | Promise<void>

const fallbackProjectURLAtom = atom<string>("")
const projectURLSourceAtom = atom<Atom<string>>(fallbackProjectURLAtom)

/** The host's project URL, e.g. `/w/<ws>/p/<project>`. Empty until a host binds one. */
export const traceDrawerProjectURLAtom = atom((get) => get(get(projectURLSourceAtom)))

/** Host seam: point the project URL at one of the host's own atoms. */
export const bindTraceDrawerProjectURLAtom = atom(null, (_get, set, source: Atom<string>) =>
    set(projectURLSourceAtom, source),
)

// A plain function rather than an atom: navigation is an action the host owns, and the callers
// are event handlers. A no-op default keeps a host that never binds from throwing.
let navigateImpl: TraceDrawerNavigate = () => undefined

/** Host seam: supply the router push the drawer should use. */
export const bindTraceDrawerNavigate = (navigate: TraceDrawerNavigate) => {
    navigateImpl = navigate
}

export const traceDrawerNavigate: TraceDrawerNavigate = (href) => navigateImpl(href)

/** Writes a router query param, shallow. `null` clears it. */
export type TraceDrawerSetQueryParam = (name: string, value: string | null | undefined) => void

let setQueryParamImpl: TraceDrawerSetQueryParam = () => undefined

/** Host seam: supply the router query-param writer the drawer should use. */
export const bindTraceDrawerSetQueryParam = (setter: TraceDrawerSetQueryParam) => {
    setQueryParamImpl = setter
}

export const traceDrawerSetQueryParam: TraceDrawerSetQueryParam = (name, value) =>
    setQueryParamImpl(name, value)

/**
 * Opening a trace in the playground and the workflow-revision drawer are playground concerns,
 * and `@agenta/playground` sits ABOVE this package. The host supplies the actions.
 */
/** What `openTraceInPlayground` resolves to: the entity to open and where it lives. */
export interface OpenInPlaygroundResult {
    entityId?: string
    appId?: string | null
    type?: "revision" | string
}

export interface TraceDrawerPlaygroundActions {
    openTraceInPlayground?: (payload: unknown) => Promise<OpenInPlaygroundResult | null>
    openWorkflowRevisionDrawer?: (payload: unknown) => void
    hasAppReference?: (span: unknown) => boolean
    /** Builds the app-playground href for a set of revision ids. */
    buildPlaygroundUrl?: (ids: string[], base: string) => string
}

const fallbackBaseAppURLAtom = atom<string>("")
const baseAppURLSourceAtom = atom<Atom<string>>(fallbackBaseAppURLAtom)

/** The host's base app URL, e.g. `/w/<ws>/p/<project>/apps`. */
export const traceDrawerBaseAppURLAtom = atom((get) => get(get(baseAppURLSourceAtom)))

/** Host seam: point the base app URL at one of the host's own atoms. */
export const bindTraceDrawerBaseAppURLAtom = atom(null, (_get, set, source: Atom<string>) =>
    set(baseAppURLSourceAtom, source),
)

let playgroundActions: TraceDrawerPlaygroundActions = {}

/** Host seam: supply the playground actions the drawer offers. */
export const bindTraceDrawerPlaygroundActions = (actions: TraceDrawerPlaygroundActions) => {
    playgroundActions = actions
}

export const getTraceDrawerPlaygroundActions = () => playgroundActions

/** Clears the drawer's `?trace`/`?span` params — the host owns how that maps to its router. */
export type TraceDrawerClearParams = () => void

let clearParamsImpl: TraceDrawerClearParams = () => undefined

export const bindTraceDrawerClearParams = (clear: TraceDrawerClearParams) => {
    clearParamsImpl = clear
}

export const traceDrawerClearParams: TraceDrawerClearParams = () => clearParamsImpl()
