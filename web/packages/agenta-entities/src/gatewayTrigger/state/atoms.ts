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
    // Optional create-mode prefill of the event (e.g. opened from the catalog
    // after picking an integration event). Ignored in edit mode.
    eventKey?: string
    // Optional create-mode prefill that pre-binds the new subscription to a
    // workflow (e.g. opened from an agent's config panel). Keyed like
    // `data.references` (`application`/`application_variant`); each value is a
    // `{id}` reference. Ignored in edit mode.
    defaultReferences?: Record<string, {id?: string; slug?: string}>
    // Human-readable label for `defaultReferences` (e.g. the agent's name), so
    // the bound-workflow field shows a name instead of a raw id. Ignored in edit mode.
    defaultBoundLabel?: string
    // When opened from an agent playground: the agent's entityId. Enables the
    // "Run in playground" action on a captured test event (channels the resolved
    // inputs into that agent's active chat session). Absent in workspace settings.
    playgroundEntityId?: string
}
export const triggerSubscriptionDrawerAtom = atom<SubscriptionDrawerState | null>(null)

// ---------------------------------------------------------------------------
// Schedule drawer state — create (no id) or edit (existing schedule id)
// ---------------------------------------------------------------------------

export interface ScheduleDrawerState {
    // Edit mode when set; create mode otherwise.
    scheduleId?: string
    // Optional create-mode prefill that pre-binds the new schedule to a workflow
    // (e.g. opened from an agent's config panel). Keyed like `data.references`
    // (`application`/`application_variant`); each value is a `{id}` reference.
    // Ignored in edit mode.
    defaultReferences?: Record<string, {id?: string; slug?: string}>
    // Human-readable label for `defaultReferences` (e.g. the agent's name), so
    // the bound-workflow field shows a name instead of a raw id. Ignored in edit mode.
    defaultBoundLabel?: string
}
export const triggerScheduleDrawerAtom = atom<ScheduleDrawerState | null>(null)

// ---------------------------------------------------------------------------
// Deliveries drawer state — opened against one subscription OR one schedule
// (a delivery belongs to exactly one of the two; XOR, DB-enforced).
// ---------------------------------------------------------------------------

export interface DeliveriesDrawerState {
    owner: {kind: "subscription" | "schedule"; id: string}
    name?: string
}
export const triggerDeliveriesDrawerAtom = atom<DeliveriesDrawerState | null>(null)
