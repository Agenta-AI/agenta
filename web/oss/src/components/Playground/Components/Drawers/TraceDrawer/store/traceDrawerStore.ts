import {atom, createStore} from "jotai"

// The shape of the drawer state
export interface TraceDrawerState {
    open: boolean
    result: any // TODO: Replace 'any' with the correct type if available
}

// Main atom for the drawer state
export const traceDrawerAtom = atom<TraceDrawerState>({open: false, result: null})

// Optional: selectors and reset atom (if you want)
export const isDrawerOpenAtom = atom((get) => get(traceDrawerAtom).open)
export const drawerResultAtom = atom((get) => get(traceDrawerAtom).result)
export const resetTraceDrawerAtom = atom(null, (get, set) =>
    set(traceDrawerAtom, {open: false, result: null}),
)

// Canonical jotai store instance for imperative usage
export const traceDrawerJotaiStore = createStore()

// Usage:
// - For imperative updates: traceDrawerJotaiStore.set(traceDrawerAtom, ...)
// - For hooks: useSetAtom(traceDrawerAtom), etc.
// - At app root: <Provider store={traceDrawerJotaiStore}>...</Provider>
