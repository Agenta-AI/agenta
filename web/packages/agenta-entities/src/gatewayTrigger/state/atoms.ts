import {atom} from "jotai"

// ---------------------------------------------------------------------------
// Catalog drawer — browse integrations to connect (independent of tools)
// ---------------------------------------------------------------------------

export const triggerCatalogDrawerOpenAtom = atom(false)

// ---------------------------------------------------------------------------
// Events drawer state — opened against a connected integration
// ---------------------------------------------------------------------------

export interface EventsDrawerState {
    providerKey: string
    integrationKey: string
    integrationName?: string
    connectionId?: string
}
export const triggerEventsDrawerAtom = atom<EventsDrawerState | null>(null)

// Drawer-local browsing state (reset on close)
export const triggerEventSearchAtom = atom("")
export const triggerSelectedCatalogEventAtom = atom<string | null>(null)

// ---------------------------------------------------------------------------
// Subscription drawer state — create (no id) or edit (existing subscription id)
// ---------------------------------------------------------------------------

export interface SubscriptionDrawerState {
    // Edit mode when set; create mode otherwise.
    subscriptionId?: string
    // Optional create-mode prefill from a chosen connection.
    connectionId?: string
    integrationKey?: string
    integrationName?: string
}
export const triggerSubscriptionDrawerAtom = atom<SubscriptionDrawerState | null>(null)

// Deliveries drawer state — opened against one subscription.
export interface DeliveriesDrawerState {
    subscriptionId: string
    subscriptionName?: string
}
export const triggerDeliveriesDrawerAtom = atom<DeliveriesDrawerState | null>(null)
