import {appendCapped, type TurnRequestCapture} from "@agenta/playground"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

/** Keep the last N turns' captures per session (ephemeral; debugging surface, not persisted). */
const MAX_TURNS = 20

const capturesBySessionAtom = atom<Record<string, TurnRequestCapture[]>>({})

/** Write one send's capture (called from the transport at send time). */
export const captureTurnRequestAtom = atom(null, (get, set, capture: TurnRequestCapture) => {
    if (!capture.sessionId) return
    const all = get(capturesBySessionAtom)
    const list = all[capture.sessionId] ?? []
    set(capturesBySessionAtom, {
        ...all,
        [capture.sessionId]: appendCapped(list, capture, MAX_TURNS),
    })
})

/** Read all captures for a session. */
export const sessionCapturesAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => get(capturesBySessionAtom)[sessionId] ?? []),
)
