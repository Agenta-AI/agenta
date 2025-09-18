import {atom} from "jotai"

/**
 * Router State Atom
 * Provides access to current route information including query parameters
 */

export interface RouterState {
    pathname: string
    query: Record<string, string | string[]>
    asPath: string
}

// Mock router state for testing and development
const defaultRouterState: RouterState = {
    pathname: "/",
    query: {},
    asPath: "/",
}

// Router atom - in real app this would be connected to Next.js router
export const routerAtom = atom<RouterState>(defaultRouterState)

// Action atom to update router state
export const updateRouterAtom = atom(null, (get, set, update: Partial<RouterState>) => {
    const current = get(routerAtom)
    set(routerAtom, {...current, ...update})
})
