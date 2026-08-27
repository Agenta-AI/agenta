import type {ListQueryState} from "@agenta/entities/shared"
import {idleReadyAtom} from "@agenta/shared/state"
import {atom, type Atom} from "jotai"

import {
    sidebarAlwaysOpenGroupsAtomFamily,
    sidebarCollapsedScopeAtomFamily,
    sidebarDefaultOpenGroupsAtomFamily,
    sidebarOpenGroupsAtomFamily,
    sidebarPopupGroupsAtomFamily,
    sidebarRouteOpenGroupsAtomFamily,
} from "../state"

import type {SidebarEntityRef, SidebarEntitySource} from "./types"

/**
 * Wraps a list atom with open-state gating. While the group is neither expanded
 * inline nor open as a collapsed flyout, the returned atom short-circuits to
 * `idle` *before* reading `listAtom` — so jotai never tracks the query dependency
 * and no fetch happens. The query subscribes (and fetches) only on demand.
 */
export const gatedSidebarSource = <TRef extends SidebarEntityRef>(
    scopeId: string,
    parentKey: string,
    listAtom: Atom<ListQueryState<TRef>>,
): Atom<SidebarEntitySource<TRef>> =>
    atom((get) => {
        // Mirror the shell's own display rule (`persisted ?? defaults`) — a `defaultOpen` group
        // is expanded on screen with nothing persisted, and must count as open here too.
        const persistedOpen = get(sidebarOpenGroupsAtomFamily(scopeId))
        const effectiveOpen =
            persistedOpen ?? get(sidebarDefaultOpenGroupsAtomFamily(scopeId)) ?? []
        // OR, not a fallback: an `alwaysOpen` group is expanded on screen with no way to collapse
        // it, so it counts as open whether or not the scope has a persisted record.
        const alwaysOpen = get(sidebarAlwaysOpenGroupsAtomFamily(scopeId)).includes(parentKey)
        // A collapsed rail renders NO inline children — a group is either a flyout there or a
        // plain link. So inline open-state cannot keep a query alive while collapsed; only a
        // flyout that is actually open can. Without this an `alwaysOpen` group (Sessions) kept
        // fetching and polling a list with nowhere to render.
        const collapsed = get(sidebarCollapsedScopeAtomFamily(scopeId))
        // The route opens a group too, without persisting anything — see the atom's note.
        const routeOpen = get(sidebarRouteOpenGroupsAtomFamily(scopeId)).includes(parentKey)
        const inlineOpen =
            !collapsed && (alwaysOpen || routeOpen || effectiveOpen.includes(parentKey))
        const popupOpen = get(sidebarPopupGroupsAtomFamily(scopeId)).includes(parentKey)

        if (!inlineOpen && !popupOpen) {
            return {status: "idle", refs: []}
        }

        // Sidebar chrome — hold the catalog queries until the first idle moment after load.
        if (!get(idleReadyAtom)) {
            return {status: "loading", refs: []}
        }

        const query = get(listAtom)
        if (query.isPending) return {status: "loading", refs: []}
        if (query.isError) return {status: "error", refs: [], error: query.error}
        return {status: "ready", refs: query.data}
    })

/**
 * Escape hatch for entities whose package exposes the query and data atoms
 * separately instead of a combined `ListQueryState` atom (e.g. evaluators).
 * Adapts them into the `ListQueryState` shape `gatedSidebarSource` expects.
 */
export const fromParts = <TRef extends SidebarEntityRef>(
    queryAtom: Atom<{isPending?: boolean; isError?: boolean; error?: Error | null}>,
    dataAtom: Atom<TRef[]>,
): Atom<ListQueryState<TRef>> =>
    atom((get) => ({
        data: get(dataAtom),
        isPending: get(queryAtom).isPending ?? false,
        isError: get(queryAtom).isError ?? false,
        error: get(queryAtom).error ?? null,
    }))
