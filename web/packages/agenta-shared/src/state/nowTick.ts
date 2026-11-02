import {atom} from "jotai"

/** A coarse clock that ticks once a minute WHILE subscribed, so relative "Xm ago" stamps and
 * "next run" times refresh on their own. One shared interval (started on first subscribe, cleared
 * on last unsubscribe) instead of one per timestamp. */
export const nowTickAtom = atom(Date.now())
nowTickAtom.onMount = (setSelf) => {
    const id = setInterval(() => setSelf(Date.now()), 60_000)
    return () => clearInterval(id)
}
