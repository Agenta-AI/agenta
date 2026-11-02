import {createContext, useContext} from "react"

import {getDefaultStore, useAtomValue} from "jotai"
import type {Atom} from "jotai"

type JotaiStore = ReturnType<typeof getDefaultStore>

/**
 * The sessions table renders its rows inside `InfiniteVirtualTable`'s ISOLATED Jotai store (it
 * creates one whenever no `store` prop is passed, and wraps rows + cells in a `<Provider>` for
 * it). The per-session cell atoms (`sessionTraceCountAtomFamily`, `sessionFirstInputAtomFamily`,
 * …) transitively depend on app context — `projectIdAtom`, `selectedAppIdAtom`, the per-session
 * spans query — which only lives in the PAGE's store. Read inside the isolated store those deps
 * resolve to their empty defaults, so every cell renders blank even though the data is loaded.
 *
 * This carries the page store down to the cells via a plain React context (independent of the
 * table's Jotai Provider), so cells read the store that actually has the data + context. We do
 * NOT pass the store to the table itself — that flips it off its isolated-store code path, which
 * blanks row rendering in this version of the table package.
 */
const SessionStoreContext = createContext<JotaiStore | null>(null)

export const SessionStoreProvider = SessionStoreContext.Provider

/** The page store the sessions table was rendered in (falls back to the default store). */
export const useSessionStore = (): JotaiStore =>
    useContext(SessionStoreContext) ?? getDefaultStore()

/** `useAtomValue`, but always reading the page store (see `SessionStoreContext`). Mirrors
 * jotai's return type (`Awaited<Value>`) so call sites are identical to plain `useAtomValue`. */
export const useSessionAtomValue = <Value,>(atom: Atom<Value>): Awaited<Value> =>
    useAtomValue(atom, {store: useSessionStore()})
