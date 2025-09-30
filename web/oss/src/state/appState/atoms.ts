import {atom} from "jotai"

import {createInitialParsedLocation} from "./parse"
import type {
    AppIdentifiers,
    AppStateSnapshot,
    NavigationCommand,
    ParsedAppLocation,
    RouteLayer,
} from "./types"

const initialParsedLocation = createInitialParsedLocation()

const initialSnapshot: AppStateSnapshot = {
    ...initialParsedLocation,
    timestamp: Date.now(),
}

export const appStateSnapshotAtom = atom<AppStateSnapshot>(initialSnapshot)

export const setLocationAtom = atom(null, (_get, set, location: ParsedAppLocation) => {
    set(appStateSnapshotAtom, {
        ...location,
        timestamp: Date.now(),
    })
})

export const appIdentifiersAtom = atom<AppIdentifiers>((get) => {
    const snapshot = get(appStateSnapshotAtom)
    return {
        workspaceId: snapshot.workspaceId,
        projectId: snapshot.projectId,
        appId: snapshot.appId,
    }
})

export const routeLayerAtom = atom<RouteLayer>((get) => get(appStateSnapshotAtom).routeLayer)

export const navigationRequestAtom = atom<NavigationCommand | null>(null)

export const requestNavigationAtom = atom(
    (get) => get(navigationRequestAtom),
    (_get, set, command: NavigationCommand | null) => {
        set(navigationRequestAtom, command)
    },
)
