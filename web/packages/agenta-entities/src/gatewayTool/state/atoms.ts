import {atom} from "jotai"

// ---------------------------------------------------------------------------
// Drawer state
// ---------------------------------------------------------------------------

export const toolCatalogDrawerOpenAtom = atom(false)

export interface ConnectionDrawerState {
    connectionId: string
    integrationKey: string
}
export const connectionDrawerAtom = atom<ConnectionDrawerState | null>(null)

// ---------------------------------------------------------------------------
// Catalog browsing state (drawer-local, reset on close)
// ---------------------------------------------------------------------------
