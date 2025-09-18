import {atom} from "jotai"
import {atomWithImmer} from "jotai-immer"

// The shape of the drawer state
export interface TraceDrawerState {
    open: boolean
    result: any // TODO: Replace 'any' with the correct type if available
}

// Main atom for the drawer state
export const traceDrawerAtom = atomWithImmer<TraceDrawerState>({open: false, result: null})

// Optional: selectors and reset atom (if you want)
export const isDrawerOpenAtom = atom((get) => get(traceDrawerAtom).open)
export const drawerResultAtom = atom((get) => get(traceDrawerAtom).result)
export const resetTraceDrawerAtom = atom(null, (_get, set) =>
    set(traceDrawerAtom, (draft) => {
        draft.open = false
        draft.result = null
    }),
)

// Close action: only toggles visibility, preserves existing trace result
export const closeTraceDrawerAtom = atom(null, (_get, set) => {
    set(traceDrawerAtom, (draft) => {
        draft.open = false
    })
})

// Optional: open/update helpers using immer
export const openTraceDrawerAtom = atom(null, (_get, set, payload: {result: any}) => {
    set(traceDrawerAtom, (draft) => {
        draft.open = true
        draft.result = payload?.result ?? draft.result
    })
})
