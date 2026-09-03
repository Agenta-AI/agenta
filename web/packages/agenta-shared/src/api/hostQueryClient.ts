import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {assertHostQueryClient} from "./queryClient"

/**
 * The QueryClient the host actually installed, read from the atom the observers use.
 *
 * Package code must never import the `queryClient` singleton directly: a host that provides its
 * own client gets working reads and silently dead writes. Resolve per call — never cache the
 * result at module scope, or you capture whatever was there before hydration.
 */
export const getHostQueryClient = () => {
    const store = getDefaultStore()
    assertHostQueryClient(() => store.get(queryClientAtom))
    return store.get(queryClientAtom)
}
