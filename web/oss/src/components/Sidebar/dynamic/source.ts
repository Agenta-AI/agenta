import type {ListQueryState} from "@agenta/entities/shared"
import {atom, type Atom} from "jotai"

import {sidebarOpenGroupsAtomFamily, sidebarPopupGroupsAtom} from "@/oss/lib/atoms/sidebar"

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
        const inlineOpen = (get(sidebarOpenGroupsAtomFamily(scopeId)) ?? []).includes(parentKey)
        const popupOpen = get(sidebarPopupGroupsAtom).includes(parentKey)

        if (!inlineOpen && !popupOpen) {
            return {status: "idle", refs: []}
        }

        const query = get(listAtom)
        return query.isPending ? {status: "loading", refs: []} : {status: "ready", refs: query.data}
    })

/**
 * Escape hatch for entities whose package exposes the query and data atoms
 * separately instead of a combined `ListQueryState` atom (e.g. evaluators).
 * Adapts them into the `ListQueryState` shape `gatedSidebarSource` expects.
 */
export const fromParts = <TRef extends SidebarEntityRef>(
    queryAtom: Atom<{isPending?: boolean}>,
    dataAtom: Atom<TRef[]>,
): Atom<ListQueryState<TRef>> =>
    atom((get) => ({
        data: get(dataAtom),
        isPending: get(queryAtom).isPending ?? false,
        isError: false,
        error: null,
    }))
