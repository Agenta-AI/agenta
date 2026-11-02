import type {Atom, createStore} from "jotai"

type Store = ReturnType<typeof createStore>

/** How long a first message waits for the build-kit overlay before it is sent without it. */
export const BUILD_KIT_WAIT_LIMIT_MS = 10_000

/**
 * Resolve once the build-kit overlay has settled (true), or after `limitMs` (false).
 *
 * A new agent's first turn must carry the build kit (tools, skills, sandbox permissions). A turn
 * sent without it runs kit-less, and the next turn's full config evicts the warm sandbox. Desktop
 * waits the same way for its first-run seed (`useFirstRunSeed`), bounded so a broken overlay
 * endpoint does not hold the message forever.
 */
export const waitForBuildKit = (
    store: Store,
    readyAtom: Atom<boolean>,
    limitMs = BUILD_KIT_WAIT_LIMIT_MS,
): Promise<boolean> =>
    new Promise((resolve) => {
        if (store.get(readyAtom)) {
            resolve(true)
            return
        }
        const finish = (ready: boolean) => {
            clearTimeout(timer)
            unsubscribe()
            resolve(ready)
        }
        const unsubscribe = store.sub(readyAtom, () => {
            if (store.get(readyAtom)) finish(true)
        })
        const timer = setTimeout(() => finish(false), limitMs)
    })
