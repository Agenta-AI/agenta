import {atom} from "jotai"

// ---------------------------------------------------------------------------
// Events drawer state — opened against a connected integration
// ---------------------------------------------------------------------------

export interface EventsDrawerState {
    providerKey: string
    integrationKey: string
    integrationName?: string
    connectionId?: string
}
export const eventsDrawerAtom = atom<EventsDrawerState | null>(null)

// Drawer-local browsing state (reset on close)
export const eventSearchAtom = atom("")
export const selectedCatalogEventAtom = atom<string | null>(null)
