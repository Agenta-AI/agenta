import {atom} from "jotai"

// ---------------------------------------------------------------------------
// Drawer state
// ---------------------------------------------------------------------------

export const catalogDrawerOpenAtom = atom(false)

export interface ConnectionDrawerState {
    connectionId: string
    integrationKey: string
}
export const connectionDrawerAtom = atom<ConnectionDrawerState | null>(null)

export interface ExecutionDrawerState {
    connectionId: string
    connectionSlug: string
    integrationKey: string
    integrationName?: string
    integrationLogo?: string
    actionKey?: string
}
export const executionDrawerAtom = atom<ExecutionDrawerState | null>(null)

// ---------------------------------------------------------------------------
// Catalog browsing state (drawer-local, reset on close)
// ---------------------------------------------------------------------------

export const catalogSearchAtom = atom("")
export const selectedCatalogIntegrationAtom = atom<string | null>(null)
export const actionSearchAtom = atom("")
export const selectedCatalogActionAtom = atom<string | null>(null)
