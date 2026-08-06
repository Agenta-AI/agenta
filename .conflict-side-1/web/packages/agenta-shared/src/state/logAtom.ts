import {Atom, getDefaultStore} from "jotai"

const globalEnabled = process.env.NEXT_PUBLIC_ENABLE_ATOM_LOGS === "true"

export function logAtom<T>(atom: Atom<T>, label: string, enabled = globalEnabled) {
    if (!enabled) return
    const store = getDefaultStore()
    queueMicrotask(() => {
        store.sub(atom, () => {
            console.debug(`[atom-log] ${label}`, store.get(atom))
        })
    })
}
