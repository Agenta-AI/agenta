import {atom} from "jotai"

import type {QueryRegistryRow} from "./queryRegistryStore"

/** Search term for the Query Registry list (client-side filter on the loaded page). */
export const querySearchTermAtom = atom("")

/**
 * Active vs archived view. Driven by the route (`/queries` vs `/queries/archived`)
 * and passed as a `mode` prop — mirrors the Evaluators archived-route pattern —
 * so it lives as a type, not a shared atom.
 */
export type QueryRegistryStatus = "active" | "archived"

/**
 * The query the manage drawer is editing, or `null` when closed. A row with an
 * empty `queryId` means "create a new query". Set by the registry dashboard, read
 * by the drawer — avoids re-fetching, since the SimpleQuery row already carries
 * the head filtering.
 */
export const queryRegistryActiveRowAtom = atom<QueryRegistryRow | null>(null)
